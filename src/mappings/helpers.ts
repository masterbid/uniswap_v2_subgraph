/* eslint-disable prefer-const */
import { log, BigInt, BigDecimal, Address, ethereum } from '@graphprotocol/graph-ts'
import { ERC20 } from '../types/Uniswap/ERC20'
import { ERC20SymbolBytes } from '../types/Uniswap/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Uniswap/ERC20NameBytes'
import { 
  // User,
  Account,
  Transaction,
  Market,
  MarketSnapshot,
  AccountPosition,
  PairSnapshot,
  Token, 
  Position, 
  PositionSnapshot, 
  Pair 
} from '../types/schema'
import { Factory as FactoryContract } from '../types/templates/Pair/Factory'
import { TokenDefinition } from './tokenDefinition'

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)

export let factoryContract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS))

// rebass tokens, dont count in tracked volume
export let UNTRACKED_PAIRS: string[] = ['0x9ea3b5b4ec044b70375236a281986106457b20ef']

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function bigDecimalExp18(): BigDecimal {
  return BigDecimal.fromString('1000000000000000000')
}

export function convertEthToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(BigInt.fromI32(18)))
}

export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

export function equalToZero(value: BigDecimal): boolean {
  const formattedVal = parseFloat(value.toString())
  const zero = parseFloat(ZERO_BD.toString())
  if (zero == formattedVal) {
    return true
  }
  return false
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

export function fetchTokenSymbol(tokenAddress: Address): string {
  // static definitions overrides
  let staticDefinition = TokenDefinition.fromAddress(tokenAddress)
  if(staticDefinition != null) {
    return (staticDefinition as TokenDefinition).symbol
  }

  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (symbolResult.reverted) {
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        symbolValue = symbolResultBytes.value.toString()
      }
    }
  } else {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  // static definitions overrides
  let staticDefinition = TokenDefinition.fromAddress(tokenAddress)
  if(staticDefinition != null) {
    return (staticDefinition as TokenDefinition).name
  }

  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (nameResult.reverted) {
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      // for broken exchanges that have no name function exposed
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        nameValue = nameResultBytes.value.toString()
      }
    }
  } else {
    nameValue = nameResult.value
  }

  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  let contract = ERC20.bind(tokenAddress)
  let totalSupplyValue = null
  let totalSupplyResult = contract.try_totalSupply()
  if (!totalSupplyResult.reverted) {
    totalSupplyValue = totalSupplyResult as i32
  }
  return BigInt.fromI32(totalSupplyValue as i32)
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  // static definitions overrides
  let staticDefinition = TokenDefinition.fromAddress(tokenAddress)
  if (staticDefinition != null) {
    return (staticDefinition as TokenDefinition).decimals
  }

  let contract = ERC20.bind(tokenAddress)
  // try types uint8 for decimals
  let decimalValue = null
  let decimalResult = contract.try_decimals()
  if (!decimalResult.reverted) {
    decimalValue = decimalResult.value
  }
  return BigInt.fromI32(decimalValue as i32)
}


export function createAccount(accountAddress: Address): Account {
  let account = Account.load(accountAddress.toHexString())
  if (account === null) {
    account = new Account(accountAddress.toHexString())
    account.save()
  }
  return account as Account
}

export function createMarket(pair: Pair): Market {
  let market = Market.load(pair.id)
  let pairContract = ERC20.bind(Address.fromString(pair.id))
  let token0Contract = ERC20.bind(Address.fromString(pair.token0))
  let token1Contract = ERC20.bind(Address.fromString(pair.token1))
  let token0Amount = token0Contract.totalSupply().toString()
  let token1Amount = token1Contract.totalSupply().toString()
  if (market == null) {
    market = new Market(pair.id)
    market.account = pair.factory
    market.protocolName = 'UNISWAP_V2'
    market.protocolType = 'EXCHANGE'
    market.inputTokens = [pair.token0, pair.token1]
    market.outputToken = pair.id
    market.inputTokenTotalBalances = [token0Amount, token1Amount]
    market.outputTokenTotalSupply = pairContract.totalSupply()
    market.blockNumber = pair.blockNumber
    market.timestamp = pair.timestamp
    market.save()
  }
  return market as Market
}

export function createMarketSnapshot(market: Market, event: ethereum.Event): void {
  let id = event.transaction.hash
    .toHexString()
    .concat(event.logIndex.toString())
  let marketSnapshot = new MarketSnapshot(id)
  marketSnapshot.market = market.id
  marketSnapshot.inputTokenBalances = market.inputTokenTotalBalances
  marketSnapshot.outputTokenTotalSupply = market.outputTokenTotalSupply
  marketSnapshot.blockNumber = market.blockNumber
  marketSnapshot.timestamp = market.timestamp
  marketSnapshot.transactionHash = event.transaction.hash.toHexString()
  marketSnapshot.transactionIndexInBlock = event.transaction.index
  marketSnapshot.logIndex = event.logIndex
  marketSnapshot.save()
}

export function createPosition(
  account: Account,
  pairAddress: string,
  type: string,
  transaction: Transaction
): Position {
  let accountId = account.id
    .concat(pairAddress)
    .concat(type)
  let accountPosition = AccountPosition.load(accountId)
  if (accountPosition === null) {
    accountPosition = new AccountPosition(accountId)
    accountPosition.positionCounter = ZERO_BI
    accountPosition.save()
  }
  let positionId = accountPosition.id.concat(accountPosition.positionCounter.toString())
  let position = Position.load(positionId)
  if (position == null) {
    position = new Position(positionId)
    position.accountPosition = accountPosition.id
    position.account = account.id
    position.accountAddress = account.id
    position.market = pairAddress
    position.marketAddress = pairAddress
    position.positionType = type
    position.outputTokenBalance = transaction.outputTokenAmount
    position.inputTokenBalances = transaction.inputTokenAmounts
    position.rewardTokenBalances = transaction.rewardTokenAmounts
    position.transferredTo = []
    position.closed = false
    position.blockNumber = transaction.blockNumber
    position.timestamp = transaction.timestamp
    position.historyCounter = ZERO_BI
    accountPosition.positionCounter = accountPosition.positionCounter.plus(ONE_BI)
    accountPosition.save()
  }
  return position as Position
}

export function createPositionSnapshot(position: Position, transaction: Transaction): void {
  let id = position.id.concat(position.historyCounter.toString())
  let positionSnapshot = new PositionSnapshot(id)
  positionSnapshot.position = position.id
  positionSnapshot.transaction = transaction.id
  positionSnapshot.outputTokenBalance = position.outputTokenBalance
  positionSnapshot.inputTokenBalances = position.inputTokenBalances
  positionSnapshot.rewardTokenBalances = position.rewardTokenBalances
  positionSnapshot.transferredTo = position.transferredTo
  positionSnapshot.save()
}

export function createPairSnapshot(pair: Pair, event: ethereum.Event): PairSnapshot {
  let id = event.transaction.hash
    .toHexString()
    .concat(event.logIndex.toString())
  let pairSnapshot = new PairSnapshot(id)
  pairSnapshot.pair = pair.id
  pairSnapshot.reserve0 = pair.reserve0
  pairSnapshot.reserve1 = pair.reserve1
  pairSnapshot.totalSupply = pair.totalSupply
  pairSnapshot.blockNumber = pair.blockNumber
  pairSnapshot.timestamp = pair.timestamp
  pairSnapshot.transactionHash = event.transaction.hash.toHexString()
  // The transactionLogIndex is the index of the transaction in the block.
  // The logIndex is the index of the log in the block logs.
  pairSnapshot.transactionIndexInBlock = event.transactionLogIndex
  pairSnapshot.logIndex = event.logIndex
  pairSnapshot.save()
  return pairSnapshot
}