require('dotenv').config();

const fs = require('fs');
const { SigningStargateClient, assertIsDeliverTxSuccess } = require("@cosmjs/stargate");
const { fromBech32 } = require("@cosmjs/encoding");
const { coins, Secp256k1HdWallet } = require("@cosmjs/amino")

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ISSUE_FILE = 'opened_issue.json';
const REQUESTS_FILE = 'requests.json';
const ATONE_DENOM = "uatone";
const RPC_ENDPOINT = "https://atomone-testnet-1-rpc.allinbits.services/";
const AMOUNT = "1000000"; // 1.0

function isValidCosmosAddress(address) {
    try {
        const decoded = fromBech32(address);
        return decoded.prefix === "atone";
    } catch (error) {
        console.log(error);
        return false;
    }
}

async function loadRequests() {
    try {
        if (fs.existsSync(REQUESTS_FILE)) {
            return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error("Error reading requests file:", error);
    }
    return { addresses: {}, authors: {} };
}

async function saveRequests(requests) {
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));
}

async function sendTransaction(recipient) {
    const signer = await Secp256k1HdWallet.fromMnemonic(PRIVATE_KEY, { prefix: 'atone' });
    const [account] = await signer.getAccounts();

    const signingClient = await SigningStargateClient.connectWithSigner(RPC_ENDPOINT, signer);

    const msg = {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
            fromAddress: account.address,
            toAddress: recipient,
            amount: coins(AMOUNT, ATONE_DENOM),
        }
    };

    const gasSim = await signingClient.simulate(account.address, [msg], { amount: coins(2000, 'uatone'), gas: "200000" });
    const adjustedGas = Math.floor(gasSim * 2.0);
    const fee = {
        gas: adjustedGas.toString(),
        amount: [
            {
                amount: (Math.ceil(0.006) * adjustedGas).toString(),
                denom: ATONE_DENOM
            }
        ]
    }

    try {
        const tx = await signingClient.sendTokens(account.address, recipient, coins(AMOUNT, ATONE_DENOM), fee)
        assertIsDeliverTxSuccess(tx)
        return tx.transactionHash;
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}

async function processIssue() {
    if (!fs.existsSync(ISSUE_FILE)) {
        console.error("Issue file not found");
        return;
    }

    const issueData = JSON.parse(fs.readFileSync(ISSUE_FILE, 'utf-8'));
    const { body, author } = issueData;
    const recipient = body.trim();

    if (!isValidCosmosAddress(recipient)) {
        console.error("Invalid Cosmos address");
        return;
    }

    const requests = await loadRequests();
    const now = Date.now();
    const expiration = now + 48 * 60 * 60 * 1000; // 48 hours later

    if (requests.addresses[recipient] && requests.addresses[recipient] > now) {
        console.error("Request already made for this recipient. Try again in 48 hours.")
        return;
    }

    if (requests.authors[author] && requests.authors[author] > now) {
        console.error("Request already made from this author. Try again in 48 hours.")
        return;
    }

    const txHash = await sendTransaction(recipient);
    console.log(`Transacted Successfully: ${txHash}`);
    requests.addresses[recipient] = expiration;
    requests.authors[author] = expiration;
    await saveRequests(requests);
}

processIssue().catch(console.error);
