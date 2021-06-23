
/* eslint-disable prefer-const */
import { log } from '@graphprotocol/graph-ts'
import { PairCreated } from '../types/Uniswap/Factory'
import { Account, Pair, Token, PairSnapshot } from '../types/schema'
import { Pair as PairTemplate } from '../types/templates'
import {
    createMarket,
    createMarketSnapshot,
    createPairSnapshot,
    FACTORY_ADDRESS,
    fetchTokenDecimals,
    fetchTokenName,
    fetchTokenSymbol,
    ZERO_BI
  } from './helpers'

export function handleNewPair(event: PairCreated): void {
  // load factory (create if first exchange)
  let account = Account.load(FACTORY_ADDRESS)
  if (account === null) {
    account = new Account(FACTORY_ADDRESS)
  }
  account.save()

  let pair = new Pair(event.params.pair.toHexString()) as Pair
  let market = createMarket(pair)

  // create the tokens
  let token0 = Token.load(event.params.token0.toHexString())
  let token1 = Token.load(event.params.token1.toHexString())

  // fetch info if null
  if (token0 === null) {
    token0 = new Token(event.params.token0.toHexString())
    token0.symbol = fetchTokenSymbol(event.params.token0)
    token0.name = fetchTokenName(event.params.token0)
    token0.tokenStandard = 'ERC20'
    token0.blockNumber = event.block.number
    token0.timestamp = event.block.timestamp
    token0.mintedByMarket = market.id
    let decimals = fetchTokenDecimals(event.params.token0)

    // bail if we couldn't figure out the decimals
    if (decimals === null) {
      log.debug('mybug the decimal on token 0 was null', [])
      return
    }
    token0.decimals = decimals.isI32()

  }

  // fetch info if null
  if (token1 === null) {
    token1 = new Token(event.params.token1.toHexString())
    token1.symbol = fetchTokenSymbol(event.params.token1)
    token1.name = fetchTokenName(event.params.token1)
    token1.tokenStandard = 'ERC20'
    token1.blockNumber = event.block.number
    token1.mintedByMarket = market.id
    token1.timestamp = event.block.timestamp
    let decimals = fetchTokenDecimals(event.params.token1)

    // bail if we couldn't figure out the decimals
    if (decimals === null) {
      return
    }
    token1.decimals = decimals.isI32()
  }

  
  pair.token0 = token0.id
  pair.token1 = token1.id
  pair.factory = account.id
  pair.reserve0 = ZERO_BI
  pair.reserve1 = ZERO_BI
  pair.totalSupply = ZERO_BI
  pair.blockNumber = event.block.number
  pair.timestamp = event.block.timestamp

  createPairSnapshot(pair, event)
  createMarketSnapshot(market, event)
    


  // create the tracked contract based on the template
  PairTemplate.create(event.params.pair)

  
  // save updated values
  market.save()
  token0.save()
  token1.save()
  pair.save()
  account.save()
}