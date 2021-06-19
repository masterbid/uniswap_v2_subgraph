import { BigInt, BigDecimal, store, Address } from '@graphprotocol/graph-ts'

import { 
  Mint as TokenMint,
  Burn as TokenBurn,
  Swap,
  Transfer,
  Sync
 } from '../generated/Uniswap/Pair'

import { 
  Account,
  Token,
  Market,
  MarketSnapshot,
  Position,
  AccountPosition,
  Pair,
  PairSnapshot,
  Mint,
  Burn,
  Transaction,
  PositionSnapshot
 } from '../generated/schema'

 import {
  convertTokenToDecimal,
  ADDRESS_ZERO,
  FACTORY_ADDRESS,
  ONE_BI,
  createUser,
  createLiquidityPosition,
  ZERO_BD,
  BI_18,
  createLiquiditySnapshot
} from './helpers'


 export function handleMint(event: TokenMint): void {
   let transaction = Transaction.load(event.transaction.hash.toHexString())
   let mint = new Mint(transaction.transactionHash.toHex())

   let pair = Pair.load(event.address.toHex())

   let token0 = Token.load(pair.token0)
   let token1 = Token.load(pair.token1)

   token0.save()
    token1.save()
    pair.save()
   
    mint.to = event.params.sender.toHex()
    mint.liquityAmount = null
    mint.amount0 = event.params.amount0
  mint.amount1 = event.params.amount1
    mint.transferEventApplied = true
    mint.syncEventApplied = true
    mint.mintEventApplied = true
    mint.save()
  }

 export function handleBurn(event: TokenBurn): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())

  if (transaction === null) {
    return
  }
  
  let burn = Burn.load(transaction.transactionHash.toHex())

  let pair = Pair.load(event.address.toHex())
  let to = Account.load(event.params.to.toHex())

  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)

  token0.save()
  token1.save()
  pair.save()
  to.save

  burn.amount0 = event.params.amount0
  burn.amount1 = event.params.amount1
  burn.liquityAmount = null
  burn.transferEventApplied = true
    burn.syncEventApplied = true
    burn.burnEventApplied = true
  burn.save()
  
 }

 export function handleSwap(event: Swap): void {

 }

 export function handleTransfer(event: Transfer): void {

 }

 export function handleSync(event: Sync): void {

 }


