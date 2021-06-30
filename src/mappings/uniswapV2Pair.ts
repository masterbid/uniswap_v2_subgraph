import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"
import {
    Account as AccountEntity,
    AccountLiquidity as AccountLiquidityEntity, 
    Burn as BurnEntity,
    Market as MarketEntity,
    Mint as MintEntity,
    Pair as PairEntity,
    PairSnapshot as PairSnapshotEntity
    
} from "../../generated/schema"
import {
    Burn,
    Mint,
    Sync,
    Transfer
} from "../../generated/templates/UniswapV2Pair/UniswapV2Pair"
import {
    ADDRESS_ZERO,
    createPairSnapshot,
    getOrCreateAccount,
    investInMarket,
    redeemFromMarket,
    TokenBalance
} from "./common"


function getOrCreateMint(event: ethereum.Event, pair: PairEntity): MintEntity {
    let mint = MintEntity.load(event.transaction.hash.toHexString())
    if (mint != null) {
        return mint as MintEntity
    }

    mint = new MintEntity(event.transaction.hash.toHexString())
    mint.pair = pair.id
    mint.transferEventApplied = false
    mint.syncEventApplied = false
    mint.mintEventApplied = false
    mint.save()
    return mint as MintEntity
}

function getOrCreateBurn(event: ethereum.Event, pair: PairEntity): BurnEntity {
    let burn = BurnEntity.load(event.transaction.hash.toHexString())
    if (burn != null) {
        return burn as BurnEntity
    }

    burn = new BurnEntity(event.transaction.hash.toHexString())
    burn.transferEventApplied = false
    burn.syncEventApplied = false
    burn.burnEventApplied = false
    burn.pair = pair.id
    burn.save()
    return burn as BurnEntity
}

export function getOrCreateLiquidity(pair: PairEntity, accountAddress: Address): AccountLiquidityEntity {
    let id = pair.id.concat("-").concat(accountAddress.toHexString())
    let liqudity = AccountLiquidityEntity.load(id)
    if (liqudity != null) {
        return liqudity as AccountLiquidityEntity
    }
    liqudity = new AccountLiquidityEntity(id)
    liqudity.pair = pair.id
    liqudity.account = getOrCreateAccount(accountAddress).id
    liqudity.balance = BigInt.fromI32(0)
    liqudity.save()
    return liqudity as AccountLiquidityEntity
}

function createOrUpdatePositionOnMint(event: ethereum.Event, pair: PairEntity, mint: MintEntity): void {
    let isComplete = mint.transferEventApplied && mint.syncEventApplied && mint.mintEventApplied
    if (!isComplete) {
        return
    }

    let accountAddress = Address.fromString(mint.to)
    //let pairAddress = Address.fromString(mint.pair)
    //let pairInstance = UniswapV2Pair.bind(pairAddress)

    let account = new AccountEntity(mint.to)
    let market = new MarketEntity(mint.pair)
    let accountLiquidity = getOrCreateLiquidity(pair, accountAddress)

    let outputTokenAmount = mint.liquidityAmount as BigInt
    let inputTokenAmounts: TokenBalance[] = []
    inputTokenAmounts.push(new TokenBalance(pair.token0, mint.to, mint.amount0 as BigInt))
    inputTokenAmounts.push(new TokenBalance(pair.token1, mint.to, mint.amount1 as BigInt))

    let outputTokenBalance = accountLiquidity.balance
    let token0Balance = outputTokenBalance.times(pair.reserve0).div(pair.totalSupply)
    let token1Balance = outputTokenBalance.times(pair.reserve1).div(pair.totalSupply)
    let inputTokenBalances: TokenBalance[] = []
    inputTokenBalances.push(new TokenBalance(pair.token0, mint.to, token0Balance))
    inputTokenBalances.push(new TokenBalance(pair.token1, mint.to, token1Balance))

    investInMarket(
        event,
        account,
        market,
        outputTokenAmount,
        inputTokenAmounts,
        [],
        outputTokenBalance,
        inputTokenBalances,
        [],
        null
    )
}

function createOrUpdatePositionOnBurn(event: ethereum.Event, pair: PairEntity, burn: BurnEntity): void {
    let isComplete = burn.transferEventApplied && burn.syncEventApplied && burn.burnEventApplied
    if (!isComplete) {
        return
    }

    let accountAddress = Address.fromString(burn.to)
    //let pairAddress = Address.fromString(burn.pair)
    //let pairInstance = UniswapV2Pair.bind(pairAddress)

    let account = new AccountEntity(burn.to)
    let market = new MarketEntity(burn.pair)
    let accountLiquidity = getOrCreateLiquidity(pair, accountAddress)

    let outputTokenAmount = burn.liquidityAmount as BigInt
    let inputTokenAmounts: TokenBalance[] = []
    inputTokenAmounts.push(new TokenBalance(pair.token0, burn.to, burn.amount0 as BigInt))
    inputTokenAmounts.push(new TokenBalance(pair.token1, burn.to, burn.amount1 as BigInt))

    let outputTokenBalance = accountLiquidity.balance
    let token0Balance = outputTokenBalance.times(pair.reserve0).div(pair.totalSupply)
    let token1Balance = outputTokenBalance.times(pair.reserve1).div(pair.totalSupply)
    let inputTokenBalances: TokenBalance[] = []
    inputTokenBalances.push(new TokenBalance(pair.token0, burn.to, token0Balance))
    inputTokenBalances.push(new TokenBalance(pair.token1, burn.to, token1Balance))

    redeemFromMarket(
        event,
        account,
        market,
        outputTokenAmount,
        inputTokenAmounts,
        [],
        outputTokenBalance,
        inputTokenBalances,
        [],
        null
    )
}

function transferLPToken(event: ethereum.Event, pair: PairEntity, from: Address, to: Address, amount: BigInt): void {
    //let pairAddress = Address.fromString(pair.id)
    //let pairInstance = UniswapV2Pair.bind(pairAddress)
    let market = new MarketEntity(pair.id)

    let fromAccount = getOrCreateAccount(from)
    let accountLiquidityFrom = getOrCreateLiquidity(pair, from)
    let fromOutputTokenBalance = accountLiquidityFrom.balance
    let fromInputTokenBalances: TokenBalance[] = []
    let fromToken0Balance = fromOutputTokenBalance.times(pair.reserve0).div(pair.totalSupply)
    let fromToken1Balance = fromOutputTokenBalance.times(pair.reserve1).div(pair.totalSupply)
    fromInputTokenBalances.push(new TokenBalance(pair.token0, fromAccount.id, fromToken0Balance))
    fromInputTokenBalances.push(new TokenBalance(pair.token1, fromAccount.id, fromToken1Balance))

    redeemFromMarket(
        event,
        fromAccount,
        market,
        amount,
        [],
        [],
        fromOutputTokenBalance,
        fromInputTokenBalances,
        [],
        to.toHexString()
    )

    let toAccount = getOrCreateAccount(to)
    let accountLiquidityTo = getOrCreateLiquidity(pair, to)
    let toOutputTokenBalance = accountLiquidityTo.balance
    let toInputTokenBalances: TokenBalance[] = []
    let toToken0Balance = toOutputTokenBalance.times(pair.reserve0).div(pair.totalSupply)
    let toToken1Balance = toOutputTokenBalance.times(pair.reserve1).div(pair.totalSupply)
    toInputTokenBalances.push(new TokenBalance(pair.token0, toAccount.id, toToken0Balance))
    toInputTokenBalances.push(new TokenBalance(pair.token1, toAccount.id, toToken1Balance))

    investInMarket(
        event,
        toAccount,
        market,
        amount,
        [],
        [],
        toOutputTokenBalance,
        toInputTokenBalances,
        [],
        from.toHexString()
    )
}

export function handleTransfer(event: Transfer): void {
    if (event.params.value == BigInt.fromI32(0)) {
        return
    }

    let pairAddressHex = event.address.toHexString()
    let fromHex = event.params.from.toHexString()
    let toHex = event.params.to.toHexString()

    let pair = PairEntity.load(pairAddressHex) as PairEntity

    // update account balances
    if (fromHex != ADDRESS_ZERO) {
        let accountLiquidityFrom = getOrCreateLiquidity(pair, event.params.from)
        accountLiquidityFrom.balance = accountLiquidityFrom.balance.minus(event.params.value)
        accountLiquidityFrom.save()
    }

    if (fromHex != pairAddressHex) {
        let accountLiquidityTo = getOrCreateLiquidity(pair, event.params.to)
        accountLiquidityTo.balance = accountLiquidityTo.balance.plus(event.params.value)
        accountLiquidityTo.save()
    }

    // Check if transfer it's a mint or burn or transfer transaction
    // minting new LP tokens
    if (fromHex == ADDRESS_ZERO) {
        pair.totalSupply = pair.totalSupply.plus(event.params.value)
        pair.save()

        let mint = getOrCreateMint(event, pair)
        mint.transferEventApplied = true
        mint.to = getOrCreateAccount(event.params.to).id
        mint.liquidityAmount = event.params.value
        mint.save()
        createOrUpdatePositionOnMint(event, pair, mint)
    }

    // send to pair contract before burn method call
    if (fromHex != ADDRESS_ZERO && toHex == pairAddressHex) {
        let burn = getOrCreateBurn(event, pair)
        burn.transferEventApplied = true
        burn.to = getOrCreateAccount(event.params.from).id
        burn.liquidityAmount = event.params.value
        burn.save()
        createOrUpdatePositionOnBurn(event, pair, burn)
    }

    // internal _burn method call
    if (fromHex == pairAddressHex && toHex == ADDRESS_ZERO) {
        pair.totalSupply = pair.totalSupply.minus(event.params.value)
        pair.save()

        let burn = getOrCreateBurn(event, pair)
        burn.liquidityAmount = event.params.value
        burn.save()
        createOrUpdatePositionOnBurn(event, pair, burn)
    }

    // everything else
    if (fromHex != ADDRESS_ZERO && fromHex != pairAddressHex && toHex != pairAddressHex) {
        transferLPToken(event, pair, event.params.from, event.params.to, event.params.value)
    }

}

export function handleMint(event: Mint): void {
    let pair = PairEntity.load(event.address.toHexString()) as PairEntity
    let mint = getOrCreateMint(event, pair)
    mint.mintEventApplied = true
    mint.amount0 = event.params.amount0
    mint.amount1 = event.params.amount1
    mint.save()
    createOrUpdatePositionOnMint(event, pair, mint)
}

export function handleBurn(event: Burn): void {
    let pair = PairEntity.load(event.address.toHexString()) as PairEntity
    let burn = getOrCreateBurn(event, pair)
    burn.burnEventApplied = true
    burn.to = getOrCreateAccount(event.params.to).id
    burn.amount0 = event.params.amount0
    burn.amount1 = event.params.amount1
    burn.save()
    createOrUpdatePositionOnBurn(event, pair, burn)
}

export function handleSync(event: Sync): void {
    let transactionHash = event.transaction.hash.toHexString()
    let id = transactionHash.concat("-").concat(event.logIndex.toHexString())
    let pairSnapshot = PairSnapshotEntity.load(id)
    if (pairSnapshot != null) {
        return
    }

    let pair = PairEntity.load(event.address.toHexString()) as PairEntity

    createPairSnapshot(pair, event)

    let possibleMint = MintEntity.load(transactionHash)
    if (possibleMint != null) {
        let mint = possibleMint as MintEntity
        mint.syncEventApplied = true
        mint.save()
        createOrUpdatePositionOnMint(event, pair, mint)
    }

    let possibleBurn = BurnEntity.load(transactionHash)
    if (possibleBurn != null) {
        let burn = possibleBurn as BurnEntity
        burn.syncEventApplied = true
        burn.save()
        createOrUpdatePositionOnBurn(event, pair, burn)
    }

}