# Brokerage Notes Parser
Parser for brokerage notes from Clear and Rico (XP Group) brokerages

## How to use
1- First you need Node.JS installed.

2- Execute `npm install` to install dependencies.

3- Place your brokerages notes inside input directory (read the readme file) they should have 'NotaCorretagem' in the file name, you can also add a XP formatted pdf statement ('Extrato da conta') to get subscription transactions.

4- Execute `npm start` to run.

*The output file should be at application's root directory under the name of 'output.json', 'transactions.csv' and 'additional.csv'*
