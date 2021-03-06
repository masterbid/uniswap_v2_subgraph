import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"
import {
    Account,
    AccountPosition,
    Market,
    Position,
    PositionSnapshot,
    MarketSnapshot,
    Token,
    Pair,
    PairSnapshot,
    Transaction
} from "../../generated/schema"
import { ERC20 } from "../../generated/UniswapV2Factory/ERC20"
import { PositionType, TokenStandard, TransactionType } from "./constants"


export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export function getOrCreateAccount(address: Address): Account {
    let addressHex = address.toHexString()
    let account = Account.load(addressHex)
    if (account != null) {
        return account as Account
    }

    account = new Account(addressHex)
    account.save()
    return account as Account
}

export function getOrCreateERC20Token(event: ethereum.Event, address: Address): Token {
    let addressHex = address.toHexString()
    let token = Token.load(addressHex)
    if (token != null) {
        return token as Token
    }

    token = new Token(addressHex)
    token.tokenStandard = TokenStandard.ERC20
    let tokenInstance = ERC20.bind(address)
    let tryName = tokenInstance.try_name()
    if (!tryName.reverted) {
        token.name = tryName.value
    }
    let trySymbol = tokenInstance.try_symbol()
    if (!trySymbol.reverted) {
        token.symbol = trySymbol.value
    }
    let tryDecimals = tokenInstance.try_decimals()
    if (!tryDecimals.reverted) {
        token.decimals = tryDecimals.value
    }
    token.blockNumber = event.block.number
    token.timestamp = event.block.timestamp
    token.save()
    return token as Token
}

export function getOrCreateMarket(
    event: ethereum.Event,
    address: Address,
    protocolName: string,
    protocolType: string,
    inputTokens: Token[],
    outputToken: Token,
    rewardTokens: Token[]
): Market {
    let addressHex = address.toHexString()
    let market = Market.load(addressHex)
    if (market != null) {
        return market as Market
    }

    market = new Market(addressHex)
    let tokenInstance = ERC20.bind(address)
    market.account = getOrCreateAccount(address).id
    market.protocolName = protocolName
    market.protocolType = protocolType
    market.inputTokens = inputTokens.map<string>(t => t.id)
    market.outputToken = outputToken.id
    market.rewardTokens = rewardTokens.map<string>(t => t.id)
    market.inputTokenTotalBalances = []
    
    let tryTotalSupply = tokenInstance.try_totalSupply()
    if (!tryTotalSupply.reverted) {
        market.outputTokenTotalSupply = tryTotalSupply.value
    }
    market.blockNumber = event.block.number
    market.timestamp = event.block.timestamp
    market.save()
    return market as Market
}

export function getOrCreateOpenPosition(
    event: ethereum.Event,
    account: Account,
    market: Market,
    positionType: string
): Position {
    let id = account.id.concat("-").concat(market.id).concat("-").concat(positionType)
    let accountPosition = AccountPosition.load(id)
    if (accountPosition == null) {
        accountPosition = new AccountPosition(id)
        accountPosition.positionCounter = BigInt.fromI32(0)
        accountPosition.save()
    }

    let pid = accountPosition.id.concat("-").concat((accountPosition.positionCounter).toString())
    let lastPosition = Position.load(pid)

    if (lastPosition == null || lastPosition.closed) {
        let newCounter = accountPosition.positionCounter.plus(BigInt.fromI32(1))
        let newPositionId = id.concat("-").concat(newCounter.toString())
        let position = new Position(newPositionId)
        position.accountPosition = accountPosition.id
        position.account = account.id
        position.accountAddress = account.id
        position.market = market.id
        position.marketAddress = market.id
        position.positionType = positionType
        position.outputTokenBalance = BigInt.fromI32(0)
        position.inputTokenBalances = []
        position.rewardTokenBalances = []
        position.transferredTo = []
        position.closed = false
        position.blockNumber = event.block.number
        position.timestamp = event.block.timestamp
        position.historyCounter = BigInt.fromI32(0)
        position.save()

        accountPosition.positionCounter = newCounter
        accountPosition.save()

        return position
    }

    return lastPosition as Position
}

export class TokenBalance {
    tokenAddress: string
    accountAddress: string
    balance: BigInt

    constructor(tokenAddress: string, accountAddress: string, balance: BigInt) {
        this.tokenAddress = tokenAddress
        this.accountAddress = accountAddress
        this.balance = balance
    }

    // Does not modify this or b TokenBalance, return new TokenBalance
    add(b: TokenBalance): TokenBalance {
        if (this.tokenAddress == b.tokenAddress) {
            return new TokenBalance(this.tokenAddress, this.accountAddress, this.balance.plus(b.balance))
        } else {
            return this
        }
    }

    toString(): string {
        return this.tokenAddress.concat("|").concat(this.accountAddress).concat("|").concat(this.balance.toString())
    }

    static fromString(tb: string): TokenBalance {
        let parts = tb.split("|")
        let tokenAddress = parts[0]
        let accountAddress = parts[1]
        let balance = BigInt.fromString(parts[2])
        return new TokenBalance(tokenAddress, accountAddress, balance)
    }
}

function addTokenBalances(atbs: TokenBalance[], btbs: TokenBalance[]): TokenBalance[] {
    if (atbs.length == 0) {
        return btbs
    }

    if (btbs.length == 0) {
        return atbs
    }

    let atbsLength = atbs.length
    let btbsLength = btbs.length

    let sum: TokenBalance[] = []

    for (let i = 0; i < btbsLength; i = i + 1) {
        let bv = btbs[i]
        let found = false
        for (let j = 0; j < atbsLength; j = j + 1) {
            let av = atbs[j]
            if (av.tokenAddress == bv.tokenAddress) {
                found = true
                sum.push(av.add(bv))
            }
        }
        if (!found) {
            sum.push(bv)
        }
    }

    return sum
}

function createPostionSnapshot(position: Position, transaction: Transaction): PositionSnapshot {
    let newCounter = position.historyCounter.plus(BigInt.fromI32(1))
    let newSnapshot = new PositionSnapshot(position.id.concat("-").concat(newCounter.toString()))
    newSnapshot.position = position.id
    newSnapshot.transaction = transaction.id
    newSnapshot.outputTokenBalance = position.outputTokenBalance
    newSnapshot.inputTokenBalances = position.inputTokenBalances
    newSnapshot.rewardTokenBalances = position.rewardTokenBalances
    newSnapshot.transferredTo = position.transferredTo
    position.blockNumber = transaction.blockNumber
    position.timestamp = transaction.timestamp
    newSnapshot.save()

    position.historyCounter = newCounter
    position.save()

    return newSnapshot
}

// We don't want to have any logic to calculae balance with protocol specific logic here
// Balance should be calculated in protocol specific evennt handlers and sent here
export function investInMarket(
    event: ethereum.Event,
    account: Account,
    market: Market,
    outputTokenAmount: BigInt,
    inputTokenAmounts: TokenBalance[],
    rewardTokenAmounts: TokenBalance[],
    outputTokenBalance: BigInt,
    inputTokenBalances: TokenBalance[],
    rewardTokenBalances: TokenBalance[],
    transferredFrom: string | null
): Position {
    // Create transaction for given event
    let transactionId = account.id.concat("-").concat(event.transaction.hash.toHexString()).concat("-").concat(event.logIndex.toHexString())
    let transaction = new Transaction(transactionId)
    transaction.transactionHash = event.transaction.hash
    transaction.market = market.id
    transaction.from = getOrCreateAccount(event.transaction.from).id
    if (event.transaction.to) {
        transaction.to = getOrCreateAccount(event.transaction.to as Address).id
    }
    if (transferredFrom == null) {
        transaction.transactionType = TransactionType.INVEST
    } else {
        transaction.transactionType = TransactionType.TRANSFER_IN
    }
    transaction.transferredFrom = transferredFrom
    transaction.inputTokenAmounts = inputTokenAmounts.map<string>(tb => tb.toString())
    transaction.outputTokenAmount = outputTokenAmount
    transaction.rewardTokenAmounts = rewardTokenAmounts.map<string>(tb => tb.toString())
    transaction.gasUsed = event.transaction.gasUsed
    transaction.gasPrice = event.transaction.gasPrice
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.transactionIndexInBlock = event.transaction.index
    transaction.save()

    let position = getOrCreateOpenPosition(event, account, market, PositionType.INVESTMENT)
    let postionSnapshot = createPostionSnapshot(position, transaction)

    position.inputTokenBalances = inputTokenBalances.map<string>(tb => tb.toString())
    position.outputTokenBalance = outputTokenBalance
    position.rewardTokenBalances = rewardTokenBalances.map<string>(tb => tb.toString())

    // Check if postion is closed
    if (position.outputTokenBalance == BigInt.fromI32(0)) {
        position.closed = true
    }

    market.inputTokenTotalBalances = inputTokenBalances.map<string>(tb => tb.toString())
    market.save()
    position.save()

    return position
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

export function createPairSnapshot(pair: Pair, event: ethereum.Event): void {
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
  
}

export function redeemFromMarket(
    event: ethereum.Event,
    account: Account,
    market: Market,
    outputTokenAmount: BigInt,
    inputTokenAmounts: TokenBalance[],
    rewardTokenAmounts: TokenBalance[],
    outputTokenBalance: BigInt,
    inputTokenBalances: TokenBalance[],
    rewardTokenBalances: TokenBalance[],
    transferredTo: string | null
): Position {
    // Create transaction for given event
    let transactionId = account.id.concat("-").concat(event.transaction.hash.toHexString()).concat("-").concat(event.logIndex.toHexString())
    let transaction = new Transaction(transactionId)
    transaction.transactionHash = event.transaction.hash
    transaction.market = market.id
    transaction.from = getOrCreateAccount(event.transaction.from).id
    if (event.transaction.to) {
        transaction.to = getOrCreateAccount(event.transaction.to as Address).id
    }
    if (transferredTo == null) {
        transaction.transactionType = TransactionType.REDEEM
    } else {
        transaction.transactionType = TransactionType.TRANSFER_OUT
    }
    transaction.transferredTo = transferredTo
    transaction.inputTokenAmounts = inputTokenAmounts.map<string>(tb => tb.toString())
    transaction.outputTokenAmount = outputTokenAmount
    transaction.rewardTokenAmounts = rewardTokenAmounts.map<string>(tb => tb.toString())
    transaction.gasUsed = event.transaction.gasUsed
    transaction.gasPrice = event.transaction.gasPrice
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.transactionIndexInBlock = event.transaction.index
    transaction.save()

    let position = getOrCreateOpenPosition(event, account, market, PositionType.INVESTMENT)
    let postionSnapshot = createPostionSnapshot(position, transaction)

    // No change in investment amount as no new investment has been made
    position.inputTokenBalances = inputTokenBalances.map<string>(tb => tb.toString())
    position.outputTokenBalance = outputTokenBalance
    position.rewardTokenBalances = rewardTokenBalances.map<string>(tb => tb.toString())

    // Check if it is transferred to some other account
    if (transferredTo != null) {
        let exists = position.transferredTo.includes(transferredTo)
        if (!exists) {
            let newTransferredTo = position.transferredTo
            newTransferredTo.push(transferredTo)
            position.transferredTo = newTransferredTo
        }
    }

    // Check if postion is closed
    if (position.outputTokenBalance == BigInt.fromI32(0)) {
        position.closed = true
    }

    market.inputTokenTotalBalances = inputTokenBalances.map<string>(tb => tb.toString())
    market.save()
    createMarketSnapshot(market, event)
    position.save()

    return position
}

export function borrowFromMarket(
    event: ethereum.Event,
    account: Account,
    market: Market,
    outputTokenAmount: BigInt,
    inputTokenAmounts: TokenBalance[],
    rewardTokenAmounts: TokenBalance[],
    outputTokenBalance: BigInt,
    inputTokenBalances: TokenBalance[],
    rewardTokenBalances: TokenBalance[]
): Position {
    // Create transaction for given event
    let transactionId = account.id.concat("-").concat(event.transaction.hash.toHexString()).concat("-").concat(event.logIndex.toHexString())
    let transaction = new Transaction(transactionId)
    transaction.transactionHash = event.transaction.hash
    transaction.market = market.id
    transaction.from = getOrCreateAccount(event.transaction.from).id
    if (event.transaction.to) {
        transaction.to = getOrCreateAccount(event.transaction.to as Address).id
    }
    transaction.transactionType = TransactionType.BORROW
    transaction.inputTokenAmounts = inputTokenAmounts.map<string>(tb => tb.toString())
    transaction.outputTokenAmount = outputTokenAmount
    transaction.rewardTokenAmounts = rewardTokenAmounts.map<string>(tb => tb.toString())
    transaction.gasUsed = event.transaction.gasUsed
    transaction.gasPrice = event.transaction.gasPrice
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.transactionIndexInBlock = event.transaction.index
    transaction.save()

    let position = getOrCreateOpenPosition(event, account, market, PositionType.DEBT)
    let postionSnapshot = createPostionSnapshot(position, transaction)

    position.inputTokenBalances = inputTokenBalances.map<string>(tb => tb.toString())
    position.outputTokenBalance = outputTokenBalance
    position.rewardTokenBalances = rewardTokenBalances.map<string>(tb => tb.toString())

    // Check if postion is closed
    if (position.outputTokenBalance == BigInt.fromI32(0)) {
        position.closed = true
    }
    market.inputTokenTotalBalances = inputTokenBalances.map<string>(tb => tb.toString())
    market.save()
    createMarketSnapshot(market, event)
    position.save()

    return position
}

export function repayToMarket(
    event: ethereum.Event,
    account: Account,
    market: Market,
    outputTokenAmount: BigInt,
    inputTokenAmounts: TokenBalance[],
    rewardTokenAmounts: TokenBalance[],
    outputTokenBalance: BigInt,
    inputTokenBalances: TokenBalance[],
    rewardTokenBalances: TokenBalance[]
): Position {
    // Create transaction for given event
    let transactionId = account.id.concat("-").concat(event.transaction.hash.toHexString()).concat("-").concat(event.logIndex.toHexString())
    let transaction = new Transaction(transactionId)
    transaction.transactionHash = event.transaction.hash
    transaction.market = market.id
    transaction.from = getOrCreateAccount(event.transaction.from).id
    if (event.transaction.to) {
        transaction.to = getOrCreateAccount(event.transaction.to as Address).id
    }
    transaction.transactionType = TransactionType.REPAY
    transaction.inputTokenAmounts = inputTokenAmounts.map<string>(tb => tb.toString())
    transaction.outputTokenAmount = outputTokenAmount
    transaction.rewardTokenAmounts = rewardTokenAmounts.map<string>(tb => tb.toString())
    transaction.gasUsed = event.transaction.gasUsed
    transaction.gasPrice = event.transaction.gasPrice
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.transactionIndexInBlock = event.transaction.index
    transaction.save()

    let position = getOrCreateOpenPosition(event, account, market, PositionType.DEBT)
    let postionSnapshot = createPostionSnapshot(position, transaction)

    // Loan amount is not changed on repayment
    position.inputTokenBalances = inputTokenBalances.map<string>(tb => tb.toString())
    position.outputTokenBalance = outputTokenBalance
    position.rewardTokenBalances = rewardTokenBalances.map<string>(tb => tb.toString())

    // Check if postion is closed
    if (position.outputTokenBalance == BigInt.fromI32(0)) {
        position.closed = true
    }
    market.inputTokenTotalBalances = inputTokenBalances.map<string>(tb => tb.toString())
    market.save()
    createMarketSnapshot(market, event)
    position.save()

    return position
}