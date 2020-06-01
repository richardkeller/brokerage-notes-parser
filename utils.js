const JSON_OUTPUT_FILE = 'output.json';
const CSV_OUTPUT_FILE = 'transactions.csv';
const CSV_ADDITIONAL_OUTPUT_FILE = 'additional.csv';

const fs = require('fs');
const moment = require('moment');
const jsonexport = require('jsonexport');

function exportJSON(json) {
    fs.writeFileSync(JSON_OUTPUT_FILE, JSON.stringify(json));
};

async function exportCSV(json) {
    try {
        let csv = await jsonexport(json.transactions, { rowDelimiter: '|' });
        fs.writeFileSync(CSV_OUTPUT_FILE, csv);
        csv = await jsonexport(json.statementLines, { rowDelimiter: '|' });
        fs.writeFileSync(CSV_ADDITIONAL_OUTPUT_FILE, csv);
    } catch (err) {
        console.error(err);
    }
}

function sortByDate(arr) {
    return arr.sort((a, b) => {
        const date1 = moment(a.date, 'DD/MM/YYYY');
        const date2 = moment(b.date, 'DD/MM/YYYY');
        return date1.diff(date2);
    });
};

function toFloat(str) {
    return parseFloat(str.replace(/\./g, '').replace(/,/g, '.'));
};

function toFixed(n) {
    return parseFloat(n.toFixed(2));
};

function trimText(str) {
    return str.replace(/\s\s+/g, ' ').trim();
};

module.exports = {
    exportJSON,
    exportCSV,
    sortByDate,
    toFixed,
    toFloat,
    trimText
};