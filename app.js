import express from 'express';
var app = express();
import cors from 'cors';
import bodyParser from 'body-parser';
import mongoose from 'mongoose';
app.set("view engine", "ejs");
import dotenv from 'dotenv';
dotenv.config();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

mongoose.connect(process.env.MONGO_URL)
    .then((conn) => {
        console.log('MongoDB Connection State:', mongoose.connection.readyState);
        
        // Start server after successful connection
        var port = process.env.PORT || '5000';
        app.listen(port, err => {
            if (err)
                throw err
            console.log('Server listening on port', port);
        });
    })
    .catch(err => {
        console.error("\nMongoDB connection error occurred!");
        console.error("Error name:", err.name);
        console.error("Error message:", err.message);
        console.error("Error code:", err.code);
        console.error("Full error stack:", err.stack);
        
        // Check for specific error details
        if (err.reason) {
            console.error("Error reason:", err.reason);
        }
        if (err.cause) {
            console.error("Error cause:", err.cause);
        }
        
        console.error("\nConnection state:", mongoose.connection.readyState);
        console.error("(0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting)");
        
        // Additional diagnostic info
        console.error("\n=== System Information ===");
        console.error("Platform:", process.platform);
        console.error("Architecture:", process.arch);
        console.error("Node version:", process.version);
        
        process.exit(1);
    });
