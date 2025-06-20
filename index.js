const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'root1234',
    database: 'todolist',
};

// Database functions
async function queryDB(sql, params) {
    const connection = await mysql.createConnection(dbConfig);
    const [results] = await connection.execute(sql, params);
    await connection.end();
    return results;
}

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    
    try {
        if (req.method === 'GET' && parsedUrl.pathname === '/') {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const items = await queryDB('SELECT * FROM items');
            const rows = items.map(item => `
                <tr data-id="${item.id}">
                    <td>${item.id}</td>
                    <td>${item.text}</td>
                </tr>
            `).join('');
            
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(html.replace('{{rows}}', rows));
            
        } else if (req.method === 'POST' && parsedUrl.pathname === '/items') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                const { text } = JSON.parse(body);
                await queryDB('INSERT INTO items (text) VALUES (?)', [text]);
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({success: true}));
            });
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    } catch (error) {
        console.error(error);
        res.writeHead(500);
        res.end('Server error');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));