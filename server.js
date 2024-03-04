const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { Client, Wallet, xrpToDrops } = require('xrpl');
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const XrpApp = require("@ledgerhq/hw-app-xrp").default;

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

async function fetchXrpData() {
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=XRP`;
    const headers = {
        'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY,
        'Accept': 'application/json'
    };

    try {
        const response = await fetch(url, { method: 'GET', headers: headers });
        const data = await response.json();

        console.log("Complete API Response:", JSON.stringify(data, null, 2)); // Log the complete response

        // Check if the expected data structure is present
        if (!data.data || !data.data.XRP) {
            console.error('Unexpected API response structure:', data);
            return null;
        }

        return {
            price: data.data.XRP.quote.USD.price,
            marketCap: data.data.XRP.quote.USD.market_cap,
            volume24h: data.data.XRP.quote.USD.volume_24h,
            circulatingSupply: data.data.XRP.circulating_supply
        };
    } catch (error) {
        console.error('Failed to fetch XRP data from CoinMarketCap:', error);
        return null;
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('A client connected');

  // Fetch and send XRP data periodically or on specific events
  const sendXrpData = async () => {
    const xrpData = await fetchXrpData();
    if (xrpData) {
      ws.send(JSON.stringify({
        type: 'xrpData',
        data: xrpData
      }));
    }
  };

  // Example: send XRP data immediately and then every 5 minutes
  sendXrpData();
  const intervalId = setInterval(sendXrpData, 60000); // 60,000 ms = 1 minutes

  ws.on('close', () => {
    console.log('A client disconnected');
    clearInterval(intervalId);
  });
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
                        walletType: 'test' // Specify wallet type
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

        console.log("Prepared transaction:", preparedTx); // Add this line for debugging

        const signedTx = senderWallet.sign(preparedTx);
        console.log("Signed transaction:", signedTx); // Add this line for debugging

        const transactionIDs = signedTx?.transactions?.map(tx => tx.id) || [];
        console.log("Transaction IDs:", signedTx.hash); // Add this line for debugging

        const txResponse = await client.submitAndWait(signedTx.tx_blob);

        const senderNewBalance = await getNewBalance(client, senderWallet.address);
        const recipientNewBalance = await getNewBalance(client, recipientAddress);

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'transactionCompleted',
                    balances: {
                        sender: { address: senderWallet.address, newBalance: senderNewBalance },
                        recipient: { address: recipientAddress, newBalance: recipientNewBalance },
                    },
                    transactionIDs: signedTx.hash // Sending transaction IDs in the WebSocket message
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

app.post('/create_real_wallet', async (req, res) => {
    // Replace the placeholder URL with the actual Mainnet WebSocket URL
    const client = new Client("wss://s1.ripple.com");

    try {
        await client.connect();
        const wallet = Wallet.generate();

        // Since there's no direct method to fund a wallet on the Mainnet through the API,
        // the wallet needs to be funded manually or through another transaction.

        // Broadcasting the wallet creation through WebSocket to connected clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'walletCreated',
                    data: {
                        xAddress: wallet.address,
                        secret: wallet.seed,
                        walletType: 'real' // Specify wallet type
                    }
                }));
            }
        });        

        await client.disconnect();

        // Respond with the wallet details (excluding balance for the Mainnet wallet)
        res.json({ xAddress: wallet.address, secret: wallet.seed });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to create real wallet' });
    }
});

app.post('/fund_wallet', async (req, res) => {
    const { xAddress } = req.query; // Assuming the X address is passed as a query parameter
    // Implement your logic for funding the wallet or initiating the login flow here
    // This is highly dependent on your application's architecture and requirements
    console.log(`Funding wallet: ${xAddress}`);

    // Dummy response for demonstration purposes
    res.json({ success: true, message: `Wallet ${xAddress} funded successfully.` });
});

app.get('/get-ledger-xrp-balance', async (req, res) => {
    const client = new Client("wss://s1.ripple.com");

    try {
        await client.connect();
        console.log('Connected to the XRP Ledger');

        const transport = await TransportNodeHid.create();
        const app = new XrpApp(transport);
        const result = await app.getAddress("44'/144'/0'/0/0");

        console.log(`Address: ${result.address}`);

        // Use the 'account_info' command to get the account details from the XRP Ledger
        const accountInfo = await client.request({
            command: 'account_info',
            account: result.address,
            ledger_index: 'validated'
        });

        console.log(`XRP Balance: ${accountInfo.result.account_data.Balance} drops`);

        // XRP is stored as drops in the ledger. 1 XRP = 1,000,000 drops
        const xrpBalance = accountInfo.result.account_data.Balance / 1000000;

        res.json({ xrpBalance: xrpBalance, address: result.address });

        await transport.close();
        await client.disconnect();
    } catch (error) {
        console.error(error);
        res.status(500).send('Error getting XRP balance');
    }
});

app.post('/send-xrp-from-ledger', async (req, res) => {
    const { receiverAddress, amount } = req.body;

    try {
        // Connect to the XRP Ledger
        const client = new Client("wss://s1.ripple.com");
        await client.connect();

        // Connect to the Ledger device
        const transport = await TransportNodeHid.create();
        const ledgerXrpApp = new XrpApp(transport);

        // Get the Ledger device's XRP address
        const { address } = await ledgerXrpApp.getAddress("44'/144'/0'/0/0");

        // Prepare the transaction
        const preparedTx = await client.autofill({
            TransactionType: "Payment",
            Account: address,
            Amount: xrpToDrops(amount.toString()), // Convert amount to drops
            Destination: receiverAddress,
        });

        const { tx_blob, hash } = await client.sign(preparedTx, ledgerXrpApp);

        // Submit the signed transaction
        const result = await client.submit(tx_blob);

        await client.disconnect();
        await transport.close();

        res.json({ success: true, hash, result });
    } catch (error) {
        console.error('Error sending XRP from Ledger:', error);
        res.status(500).json({ error: 'Failed to send XRP from Ledger', details: error.message });
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
