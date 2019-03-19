const bitcoin = require('bitgo-utxo-lib')
const util = require('./util.js')

const scriptCompile = addrHash => bitcoin.script.compile([
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    addrHash,
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG
])

const scriptFoundersCompile = address => bitcoin.script.compile([
    bitcoin.opcodes.OP_HASH160,
    address,
    bitcoin.opcodes.OP_EQUAL
])

// public members
let txHash
exports.txHash = () => txHash

exports.createGeneration = (rpcData, blockReward, feeReward, recipients, poolAddress, poolHex, coin, masternodeReward, masternodePayee, masternodePayments) => {
    let poolAddrHash = bitcoin.address.fromBase58Check(poolAddress).hash

    let network = coin.network
    //console.log('network: ', network)
    let txb = new bitcoin.TransactionBuilder(network)

    // Set sapling or overwinter to either true OR block height to activate.
    // NOTE: if both are set, sapling will be used.
    if (coin.sapling === true || (typeof coin.sapling === 'number' && coin.sapling <= rpcData.height)) {
        txb.setVersion(bitcoin.Transaction.ZCASH_SAPLING_VERSION);
    } else if (coin.overwinter === true || (typeof coin.overwinter === 'number' && coin.overwinter <= rpcData.height)) {
        txb.setVersion(bitcoin.Transaction.ZCASH_OVERWINTER_VERSION);
    }

    // input for coinbase tx
    let blockHeightSerial = (rpcData.height.toString(16).length % 2 === 0 ? '' : '0') + rpcData.height.toString(16)

    let height = Math.ceil((rpcData.height << 1).toString(2).length / 8)
    let lengthDiff = blockHeightSerial.length / 2 - height
    for (let i = 0; i < lengthDiff; i++) {
        blockHeightSerial = `${blockHeightSerial}00`
    }

    let length = `0${height}`
    let serializedBlockHeight = new Buffer.concat([
        new Buffer(length, 'hex'),
        util.reverseBuffer(new Buffer(blockHeightSerial, 'hex')),
        new Buffer('00', 'hex') // OP_0
    ])

    txb.addInput(new Buffer('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
        4294967295,
        4294967295,
        new Buffer.concat([
            serializedBlockHeight,
            // Default s-nomp pool https://github.com/s-nomp/s-nomp/wiki/Insight-pool-link
            Buffer(poolHex ? poolHex : '44656661756C7420732D6E6F6D7020706F6F6C2068747470733A2F2F6769746875622E636F6D2F732D6E6F6D702F732D6E6F6D702F77696B692F496E73696768742D706F6F6C2D6C696E6B', 'hex')
        ])
    )

    // calculate total fees
    let feePercent = 0
    recipients.forEach(recipient => feePercent += recipient.percent)

    var totalReward = blockReward.total;

    // calculate masternodes dPoS reward
    if (rpcData.coinbasetxn && rpcData.coinbasetxn.masternodesRewards) {
        rpcData.coinbasetxn.masternodesRewards.forEach(function (masternodeReward) {
            totalReward -= masternodeReward.amount;
        });
    }

    // pool t-addr
    txb.addOutput(
        scriptCompile(poolAddrHash),
        Math.round(totalReward * (1 - (feePercent / 100))) + feeReward
    )

    // Segwit support
    // if (rpcData.default_witness_commitment !== undefined) {
    //     txb.addOutput(new Buffer(rpcData.default_witness_commitment, 'hex'), 0);
    // }

    // pool fee recipients t-addr
    if (recipients.length > 0 && recipients[0].address != '') {
        let burn = 0
        if (coin.burnFees) {
            burn = feeReward
        }
        recipients.forEach(recipient => { 
            txb.addOutput(
                scriptCompile(bitcoin.address.fromBase58Check(recipient.address).hash),
                Math.round(totalReward.total * (recipient.percent / 100) - burn)
            )
            burn = 0
        })
    }

    if (rpcData.coinbasetxn && rpcData.coinbasetxn.masternodesRewards) {
        rpcData.coinbasetxn.masternodesRewards.forEach(function (masternodeReward) {
            txb.addOutput(
                new Buffer(masternodeReward.script, 'hex'),
                masternodeReward.amount
            );
        });
    }

    let tx = txb.build()

    txHex = tx.toHex()
    // console.log('hex coinbase transaction: ' + txHex)

    // assign
    txHash = tx.getHash().toString('hex')

    // console.log(`txHex: ${txHex.toString('hex')}`)
    // console.log(`txHash: ${txHash}`)

    return txHex
}

module.exports.getFees = feeArray => {
    let fee = Number()
    feeArray.forEach(value => fee += Number(value.fee))
    return fee
}
