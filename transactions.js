const unknowns = [];

const fs = require('fs');
const path = require('path');
const util = require('util');

const utils = require('./utils');
const config = require('./config');
const tickers = require('./tickers');
const extras = require('./input/extras');

const PDF2JSON = util.promisify(require('pdf-parser').pdf2json);


function getPDFFiles() {
    const INPUT_PATH = './input';
    const files = [];
    const fileNames = fs.readdirSync(INPUT_PATH).filter(f => f.endsWith('.pdf'));
    for (const fileName of fileNames) {
        const filePath = path.join(INPUT_PATH, fileName);
        const file = fs.readFileSync(filePath);
        const type = fileName.toLowerCase().includes('notacorretagem') ? 'note' : 'statement';
        files.push({ type: type, file: file });
    }
    return files;
};

async function extractPages(pdfFiles) {
    const pages = {
        statements : [],
        notes: [],
    };
    for (const pdf of pdfFiles) {
        const data = await PDF2JSON(pdf.file);
        data.pages = data.pages.sort((a,b)=> a.pageId - b.pageId);
        if (pdf.type == 'note') {
            pages.notes.push(...data.pages)
        } else {
            pages.statements.push(...data.pages)
        }
    }
    
    return pages;
};

function getPageSummary(page) {
    return {
        date : getDate(page),
        cost: getCost(page),
        taxes: getTaxes(page)
    }
}
// If you have executed more than 18 operations in the same day, the summary will be on the next page
function isPartialPage(page){
    return page.texts.some(t => t.text === 'CONTINUA...');
}
function extractData(pages) {
    const data = {
        transactions: [],
        statementLines: [],
    };
    for (let i = 0; i < pages.notes.length; i++) {
        const page = pages.notes[i];
        const partialPage = isPartialPage(page);
        let date, cost, taxes;
        if (partialPage && pages.notes[i+1] != null) {
            for (let j = i+1; j< pages.notes.length; j++) {
                if (!isPartialPage(pages.notes[j])){
                    ({date, cost, taxes} = getPageSummary(pages.notes[j]));
                    break;
                }
            }
            if (date == null) {
                throw new Error('Could not find page summary');
            }
        } else {
            ({date, cost, taxes} = getPageSummary(page));
        }

        const pageTexts = [];

        for (const text of page.texts) {
            const clearText = utils.trimText(text.text);
            pageTexts.push(clearText);
        }

        data.transactions.push(...extractTransactions(pageTexts, date, cost, taxes));
    }
    for (const page of pages.statements) {
      const isFirstPage = page.texts[0] && page.texts[0].text === 'Extrato';
      let i = 0;
      if (isFirstPage) {
        i = page.texts.findIndex(t => t.text === 'Valor') + 2;
      }
      
      while (i < page.texts.length) {
        if (page.texts.length >= i+4) {
            const liqDate = page.texts[i].text;
            const movDate = page.texts[++i].text;
          if (isValidDate(liqDate) && isValidDate(movDate)) {
            let fullDescription = page.texts[++i].text;
            while (!page.texts[++i].text.includes('R$')){
              fullDescription += ' '+ page.texts[i].text;
            }
            const amount = utils.toFloat(page.texts[i].text.replace('R$', ''));
            const balance = utils.toFloat(page.texts[++i].text.replace('R$', ''));
            const subscriptionDescriptions = ['COMPRA DE OFERTA DE AÇÕES','SUBSCRIÇÃO'];
            let quantity;
            // TODO: there is no way to know RECEBIMENTO DE SUBSCRIÇÃO DE SOBRAS ticker
            if (subscriptionDescriptions.find((d) => fullDescription.includes(d)) &&
              !fullDescription.includes('RECEBIMENTO DE SUBSCRIÇÃO DE SOBRAS')) {
              let description;
              let sub = fullDescription.match(/SUBSCRIÇÃO BR([a-zA-Z]{4}).*S\/ (\d+)/);
              if (sub && sub.length == 3) {
                description = sub[1];
                quantity = parseInt(sub[2]);
              } else {
                sub = fullDescription.match(/COMPRA DE OFERTA DE AÇÕES BR([a-zA-Z]{4}).* (\d+)/);
                if(sub && sub.length == 3) {
                  description = sub[1];
                  quantity = parseInt(sub[2]);
                } else {
                  throw new Error('Could not parse subscription transactions');
                }
              }
              data.transactions.push({ name: description + '('+ fullDescription + ')', date: liqDate, type: config.SUBSCRIPTION_STRING, quantity, value: -1 * (amount/quantity),  tax: 0 });
            } else {
              data.statementLines.push({ name: fullDescription, date: liqDate, type: '?', quantity: '?', value: amount, tax: 0 });
            }
            i++;
          } else {
              break;
          }
        } else {
          break;
        }
      }
    }

    for (const transaction of data.transactions) {
      if ([config.BUY_STRING,config.SUBSCRIPTION_STRING].includes(transaction.type)) {
        transaction.irpf_text = `${transaction.name} comprados em ${transaction.date} por R$ ${transaction.value} cada`
      } else {
        transaction.irpf_text = `${transaction.name} vendidos em ${transaction.date} por R$ ${transaction.value} cada`
      }
    }
    return data;
};

function isValidDate(text) {
    return text.match(/\d\d\/\d\d\/\d\d\d\d/);
}

function getDate(page) {
    const PIVOT_TEXT = 'Data pregão';
    for (let i = 0; i < page.texts.length; i++) {
        const text = page.texts[i].text;
        if (text === PIVOT_TEXT) {
            return page.texts[i + 1].text;
        }
    }

    throw 'Não foi possível encontrar a data de operação';
};

function getCost(page) {
    const PIVOT_TEXT = 'Resumo dos Negócios';
    for (let i = 0; i < page.texts.length; i++) {
        const text = page.texts[i].text;
        if (text === PIVOT_TEXT) {
            return utils.toFloat(page.texts[i - 1].text);
        }
    }

    throw 'Não foi possivel encontrar os custos';
};

function getTaxes(page) {
    let totalTaxes = 0.0;
    const CBL_STRING = 'Total CBLC';
    const VALUE_STRING = 'Valor líquido das operações';
    const BOVESPA_STRING = 'Total Bovespa / Soma';
    const COSTS_STRING = 'Total Custos / Despesas';
    const ZERO_TAX = 'D';

    for (let i = 0; i < page.texts.length; i++) {
        const text = page.texts[i].text;

        if (text === CBL_STRING) {
            totalTaxes = utils.toFixed(totalTaxes + utils.toFloat(page.texts[i - 1].text));
        }

        if (text === VALUE_STRING) {
            totalTaxes = utils.toFixed(totalTaxes - utils.toFloat(page.texts[i - 1].text));
            if (totalTaxes < 0) {
                totalTaxes *= -1;
            }
        }

        if (text === BOVESPA_STRING) {
            if (page.texts[i - 1].text != ZERO_TAX)
                totalTaxes = utils.toFixed(totalTaxes + utils.toFloat(page.texts[i - 1].text));
        }

        if (text === COSTS_STRING) {
            totalTaxes = utils.toFixed(totalTaxes + utils.toFloat(page.texts[i - 1].text));
        }
    }

    return totalTaxes;
};

function calculateTax(value, cost, tax) {
    return tax == 0 ? 0 : utils.toFixed(value / cost * tax);
};

function extractTransactions(pageTexts, date, cost, taxes) {
    const transactions = [];

    let pivotIndex = 0;
    const DOC_BUY_STRING = 'C';
    const DOC_SELL_STRING = 'V';
    const DOC_BUY_END_STRING = 'D';
    const DOC_SELL_END_STRING = 'C';
    const DOC_START_STRING = '1-BOVESPA';
    const DOC_END_STRING = 'NOTA DE NEGOCIAÇÃO';

    for (let i = 0; i < pageTexts.length; i++) {
        const text = pageTexts[i];

        if (text === DOC_START_STRING) {
            pivotIndex = i + 1;
            continue;
        }

        if ((text === DOC_BUY_END_STRING && (pageTexts[i + 1] === DOC_START_STRING || pageTexts[i + 1] === DOC_END_STRING)) || (text === DOC_SELL_END_STRING && pageTexts[pivotIndex] === DOC_SELL_STRING)) {
            const name = getTicker(pageTexts[pivotIndex + 2]);
            const quantity = parseInt(pageTexts[i - 3]);
            const value = utils.toFloat(pageTexts[i - 2]);
            const tax = calculateTax(quantity * value, cost, taxes);
            const type = pageTexts[pivotIndex] === DOC_BUY_STRING ? config.BUY_STRING : config.SELL_STRING;
            transactions.push({ name, date, type, quantity, value, tax });
            continue;
        }

        if (text === DOC_END_STRING) {
            break;
        }
    }
    return transactions;
};

function getTicker(str) {
    const FII = "FII";
    if (str.startsWith(FII)) {
        // So far its working: get the 2nd last name
        const arr = str.split(' ');
        return arr[arr.length - 2];
    } else if (tickers[str]) {
        return tickers[str];
    } else {
        unknowns.push(str);
        return str;
    }
};

async function load() {
    const files = getPDFFiles();
    const pages = await extractPages(files);
    const data = extractData(pages);
    data.transactions.push(...extras);
    return { 
      transactions: utils.sortByDate(data.transactions),
      statementLines: utils.sortByDate(data.statementLines),
      unknowns
    };
};


module.exports = { load };