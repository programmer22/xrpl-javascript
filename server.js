const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { Client, Wallet, xrpToDrops } = require('xrpl');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('A client connected');

    ws.on('close', () => console.log('A client disconnected'));
});

const getNewBalance = async (client, address) => {
    const accountInfo = await client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'validated'
    });
    return accountInfo.result.account_data.Balance;
};

app.post('/create_test_wallet', async (req, res) => {
    const client = new Client("wss://s.altnet.rippletest.net:51233");
    try {
        await client.connect();
        const wallet = Wallet.generate();
        await client.fundWallet(wallet);
        await client.disconnect();

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'walletCreated',
                    data: {
                        xAddress: wallet.address,
                        balance: "10000000", // Example starting balance
                        secret: wallet.seed,
                    }
                }));
            }
        });

        res.json({ xAddress: wallet.address, balance: "10000000", secret: wallet.seed });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to create wallet' });
    }
});

app.post('/send_xrp', async (req, res) => {
    const { senderSecret, recipientAddress, amount } = req.body;
    const client = new Client("wss://s.altnet.rippletest.net:51233");

    try {
        await client.connect();
        const senderWallet = Wallet.fromSecret(senderSecret);
        
        const preparedTx = await client.autofill({
            TransactionType: "Payment",
            Account: senderWallet.address,
            Amount: xrpToDrops(amount.toString()),
            Destination: recipientAddress,
        });
        
        const signedTx = senderWallet.sign(preparedTx);
        const txResponse = await client.submitAndWait(signedTx.tx_blob);

        const senderNewBalance = await getNewBalance(client, senderWallet.address);
        const recipientNewBalance = await getNewBalance(client, recipientAddress);

        // Extracting transaction IDs from the signed transaction
        const transactionIDs = signedTx.transactions.map(tx => tx.id);

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'transactionCompleted',
                    balances: {
                        sender: { address: senderWallet.address, newBalance: senderNewBalance },
                        recipient: { address: recipientAddress, newBalance: recipientNewBalance },
                    },
                    transactionIDs: transactionIDs // Sending transaction IDs in the WebSocket message
                }));
            }
        });

        await client.disconnect();
        res.json({ txResponse, senderNewBalance, recipientNewBalance });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to send XRP' });
    }
});

server.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});



// const express = require('express');
// const cors = require('cors');
// const { Client, Wallet } = require('xrpl');

// const app = express();
// const port = process.env.PORT || 3000;

// app.use(cors());
// app.use(express.json());

// // Serve static files from the 'public' directory
// app.use(express.static('public'));

// app.post('/create_test_wallet', async (req, res) => {
//     const client = new Client("wss://s.altnet.rippletest.net:51233");
//     try {
//         await client.connect();
//         const wallet = Wallet.generate();
//         const fundResult = await client.fundWallet(wallet);
//         await client.disconnect();

//         res.json({
//             xAddress: wallet.address,
//             balance: fundResult.balance,
//             secret: wallet.seed, // Note: Exposing secrets is risky
//         });
//     } catch (error) {
//         console.error('Error:', error);
//         res.status(500).json({ error: 'Failed to create wallet' });
//     }
// });

// app.listen(port, () => {
//     console.log(`Server listening at http://localhost:${port}`);
// });
