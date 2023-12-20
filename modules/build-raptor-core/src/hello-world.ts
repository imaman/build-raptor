#!/usr/bin/env node

function print(...args: unknown[]) {
  console.log(...args) // eslint-disable-line no-console
}

async function main(args: string[]) {
  print(`<GM> ${JSON.stringify(args.slice(2))}`) // 124536
}

main(process.argv)
