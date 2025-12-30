# naologic-erp

## Set up

Run the following commands to set up the program

1) `npm i`
2) `npx tsc`
3) `node dist/index.js`


## Changing data
There a two files to test against. There is data to run for a single location as well as to check for circular dependencies.
When changing data, go to index.ts and uncomment the data you wish to run, and comment out the data your wish to ignore.
When changing between data, or making changes to the application you must rebuild the app first, then run it. Follow steps 2 and 3 of the set up to build and run.