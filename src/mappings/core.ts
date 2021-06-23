/* eslint-disable prefer-const */
import { BigInt, BigDecimal, store, Address } from '@graphprotocol/graph-ts'
import {
  Pair,
  Token,
  Market,
  Transaction,
  Mint as MintEvent,
  Burn as BurnEvent,
  Account,
} from '../types/schema'
import { Pair as PairContract, Mint, Burn, Swap, Transfer, Sync } from '../types/templates/Pair/Pair'
import {
    ADDRESS_ZERO,
    ONE_BI,
    createAccount,
    createPairSnapshot,
    createPosition,
    createPositionSnapshot,
    ZERO_BI
  } from './helpers'



  export function handleTransfer(event: Transfer): void {
    if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.value.equals(BigInt.fromI32(1000))) {
      return
    }
    let from = event.params.from
    let to = event.params.to
    let fromAccount = createAccount(from)
    let toAccount = createAccount(to)
    let pair = Pair.load(event.address.toHexString()) as Pair
    let pairContract = PairContract.bind(event.address)
    let market = Market.load(event.address.toHexString())
  
    // liquidity token amount being transfered
    let value = event.params.value
    let transactionHash = event.transaction.hash.toHexString()
  
    let transactionId = fromAccount.id
      .concat(transactionHash)
      .concat(event.logIndex.toString())
    let transaction = Transaction.load(transactionId) as Transaction
    if (transaction === null) {
      transaction = new Transaction(transactionId)
      transaction.transactionHash = event.transaction.hash
      transaction.market = market.id
      transaction.from = fromAccount.id
      transaction.to = toAccount.id
      transaction.transactionType = 'INVEST'
      transaction.inputTokenAmounts = []
      transaction.outputTokenAmount = ZERO_BI
      transaction.rewardTokenAmounts = [ZERO_BI.toString()]
      transaction.gasPrice = event.transaction.gasPrice
      transaction.gasUsed = event.transaction.gasUsed
      transaction.blockNumber = event.block.number
      transaction.timestamp = event.block.timestamp
      transaction.transactionIndexInBlock = event.transactionLogIndex
    }
    if (from.toHexString() == ADDRESS_ZERO) {
      createPairSnapshot(pair, event)
      pair.totalSupply = pair.totalSupply.plus(value)
      pair.save()
  
      let mint = new MintEvent(transactionHash)
      mint.pair = pair.id
      mint.to = to.toHexString()
      mint.liquidityAmount = value
      mint.transferEventApplied = true
      mint.syncEventApplied = false
      mint.mintEventApplied = true
      mint.save()
  
      transaction.save()
      createPairSnapshot(pair, event)
    }
    if (to.toHexString() == pair.id) {
      let burn = new BurnEvent(transactionHash)
      burn.pair = pair.id
      burn.to = toAccount.id
      burn.liquidityAmount = value
      burn.transferEventApplied = true
      burn.syncEventApplied = false
      burn.burnEventApplied = true
      burn.save()
  
      transaction.save()
      createPairSnapshot(pair, event)
    }
    if (to.toHexString() == ADDRESS_ZERO && from.toHexString() == pair.id) {
      createPairSnapshot(pair, event)
      pair.totalSupply = pair.totalSupply.minus(value)
      pair.save()
      createPairSnapshot(pair, event)
      let burn = BurnEvent.load(transactionHash)
      if (burn === null) {
        burn.pair = pair.id
        burn.to = fromAccount.id
        burn.liquidityAmount = value
        burn.transferEventApplied = true
        burn.syncEventApplied = false
        burn.burnEventApplied = true
        burn.save()
      }
    }
    if (from.toHexString() != ADDRESS_ZERO && from.toHexString() != pair.id) {
      transaction.transactionType = 'TRANSFER_IN'
      let fromUserPosistion = createPosition(fromAccount, pair.id, 'INVESTMENT', transaction)
      createPositionSnapshot(fromUserPosistion, transaction)
      fromUserPosistion.outputTokenBalance = pairContract.balanceOf(from)
      fromUserPosistion.historyCounter = fromUserPosistion.historyCounter.plus(ONE_BI)
      fromUserPosistion.save()
      transaction.save()
    }
  
    if (event.params.to.toHexString() != ADDRESS_ZERO && to.toHexString() != pair.id) {
      transaction.transactionType = 'TRANSFER_OUT'
      let toUserPosition = createPosition(toAccount, pair.id, 'INVESTMENT', transaction)
      createPositionSnapshot(toUserPosition, transaction)
      toUserPosition.outputTokenBalance = pairContract.balanceOf(to)
      toUserPosition.historyCounter = toUserPosition.historyCounter.plus(ONE_BI)
      toUserPosition.save()
      transaction.save()
    }
    transaction.save()
  }

  export function handleMint(event: Mint): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString()) as Transaction
    let mint = MintEvent.load(event.transaction.hash.toHexString())
    let pair = Pair.load(event.address.toHexString())
  
    let token0Input = event.params.amount0.toString()
    let token1Input = event.params.amount1.toString()
    transaction.inputTokenAmounts = [token0Input, token1Input]
  
    mint.pair = pair.id
    mint.to = event.params.sender.toHexString()
    mint.liquidityAmount = event.transaction.value
    mint.amount0 = event.params.amount0
    mint.amount1 = event.params.amount1
    mint.transferEventApplied = false
    mint.syncEventApplied = false
    mint.mintEventApplied = true
    mint.save()
  
    let account = Account.load(transaction.from) as Account
    let position = createPosition(account, pair.id, 'INVESTMENT', transaction)
    createPositionSnapshot(position, transaction)
    position.historyCounter = position.historyCounter.plus(ONE_BI)
    position.save()
  }
  
  export function handleBurn(event: Burn): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString()) as Transaction
    if (transaction === null) {
      return
    }
    let burn = BurnEvent.load(event.transaction.hash.toHexString())
    let pair = Pair.load(event.address.toHexString())
  
    let token0Input = event.params.amount0.toString()
    let token1Input = event.params.amount1.toString()
    transaction.inputTokenAmounts = [token0Input, token1Input]
  
    burn.amount0 = event.params.amount0
    burn.amount1 = event.params.amount1
    burn.burnEventApplied = true
    burn.save()
  
    let account = Account.load(transaction.from) as Account
    let position = createPosition(account, pair.id, 'DEBT', transaction)
    createPositionSnapshot(position, transaction)
    position.historyCounter = position.historyCounter.plus(ONE_BI)
    position.save()
  }

  export function handleSwap(event: Swap): void {
    let pair = Pair.load(event.address.toHexString())
    let amount0In = event.params.amount0In.toString()
    let amount1In = event.params.amount1In.toString()
    let amount1Out = event.params.amount1Out
    let accountFrom = Account.load(event.transaction.from.toHexString())
    let accountTo = Account.load(event.params.to.toHexString())
    let transactionId = accountFrom.id
      .concat('-')
      .concat(event.transaction.hash.toHexString())
      .concat('-')
      .concat(event.logIndex.toString())
    let transaction = Transaction.load(transactionId)
    if (transaction === null) {
      transaction = new Transaction(transactionId)
      transaction.transactionHash = event.transaction.hash
      transaction.market = pair.id
      transaction.from = accountFrom.id
      transaction.to = accountTo.id
      transaction.transactionType = 'INVEST'
      transaction.inputTokenAmounts = [amount0In, amount1In]
      transaction.outputTokenAmount = amount1Out
      transaction.rewardTokenAmounts = [ZERO_BI.toString()]
      transaction.gasPrice = event.transaction.gasPrice
      transaction.gasUsed = event.transaction.gasUsed
      transaction.blockNumber = event.block.number
      transaction.timestamp = event.block.timestamp
      transaction.transactionIndexInBlock = event.transactionLogIndex
    }
    transaction.save()
  }

  export function handleSync(event: Sync): void {
    let pair = Pair.load(event.address.toHexString()) as Pair
    createPairSnapshot(pair, event)
    pair.reserve0 = event.params.reserve0
    pair.reserve1 = event.params.reserve1
    pair.save()
  }

  

