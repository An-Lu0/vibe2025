const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const bcrypt = require('bcrypt');
const cookie = require('cookie');
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

// Auth middleware
async function authenticate(req) {
    const cookies = cookie.parse(req.headers.cookie || '');
    if (!cookies.sessionId) return null;
    
    try {
        const [user] = await queryDB(
            'SELECT u.id, u.username FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > NOW()',
            [cookies.sessionId]
        );
        return user || null;
    } catch (error) {
        console.error('Authentication error:', error);
        return null;
    }
}

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const user = await authenticate(req);
    
    try {
        // Serve static files
        if (req.method === 'GET' && /\.(css|js|html)$/.test(parsedUrl.pathname)) {
            try {
                const content = await fs.promises.readFile(path.join(__dirname, parsedUrl.pathname));
                res.writeHead(200);
                res.end(content);
                return;
            } catch {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
        }

        // Auth routes
        if (req.method === 'GET' && parsedUrl.pathname === '/login') {
            if (user) {
                res.writeHead(302, {'Location': '/'});
                res.end();
                return;
            }
            const html = await fs.promises.readFile(path.join(__dirname, 'login.html'), 'utf8');
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(html);
            return;
        }
        
        if (req.method === 'POST' && parsedUrl.pathname === '/login') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                const { username, password } = JSON.parse(body);
                const [user] = await queryDB('SELECT * FROM users WHERE username = ?', [username]);
                
                if (user && await bcrypt.compare(password, user.password_hash)) {
                    const sessionId = require('crypto').randomBytes(16).toString('hex');
                    await queryDB(
                        'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))',
                        [sessionId, user.id]
                    );
                    
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': cookie.serialize('sessionId', sessionId, {
                            httpOnly: true,
                            maxAge: 60 * 60 * 24,
                            path: '/'
                        })
                    });
                    res.end(JSON.stringify({success: true, username: user.username}));
                } else {
                    res.writeHead(401, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({success: false, error: 'Invalid credentials'}));
                }
            });
            return;
        }
        
        if (req.method === 'GET' && parsedUrl.pathname === '/register') {
            if (user) {
                res.writeHead(302, {'Location': '/'});
                res.end();
                return;
            }
            const html = await fs.promises.readFile(path.join(__dirname, 'register.html'), 'utf8');
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(html);
            return;
        }
        
        if (req.method === 'POST' && parsedUrl.pathname === '/register') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                const { username, password } = JSON.parse(body);
                
                if (!username || !password) {
                    res.writeHead(400, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({success: false, error: 'Username and password are required'}));
                    return;
                }
                
                if (password.length < 6) {
                    res.writeHead(400, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({success: false, error: 'Password must be at least 6 characters'}));
                    return;
                }
                
                try {
                    const passwordHash = await bcrypt.hash(password, 10);
                    await queryDB('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({success: true}));
                } catch (error) {
                    if (error.code === 'ER_DUP_ENTRY') {
                        res.writeHead(400, {'Content-Type': 'application/json'});
                        res.end(JSON.stringify({success: false, error: 'Username already exists'}));
                    } else {
                        console.error('Registration error:', error);
                        res.writeHead(500, {'Content-Type': 'application/json'});
                        res.end(JSON.stringify({success: false, error: 'Registration failed'}));
                    }
                }
            });
            return;
        }
        
        // New endpoint to get current user info
        if (req.method === 'GET' && parsedUrl.pathname === '/api/me') {
            if (!user) {
                res.writeHead(401, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Unauthorized'}));
                return;
            }
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({username: user.username}));
            return;
        }
        
        if (req.method === 'POST' && parsedUrl.pathname === '/logout') {
            const cookies = cookie.parse(req.headers.cookie || '');
            if (cookies.sessionId) {
                await queryDB('DELETE FROM sessions WHERE id = ?', [cookies.sessionId]);
            }
            
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': cookie.serialize('sessionId', '', {
                    httpOnly: true,
                    expires: new Date(0),
                    path: '/'
                })
            });
            res.end(JSON.stringify({success: true}));
            return;
        }
        
        // Protected routes
        if (!user) {
            res.writeHead(302, {'Location': '/login'});
            res.end();
            return;
        }
        
        if (req.method === 'GET' && parsedUrl.pathname === '/') {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const items = await queryDB('SELECT * FROM items WHERE user_id = ? ORDER BY id', [user.id]);
            
            const rows = items.map((item, index) => `
                <tr data-id="${item.id}">
                    <td>${index + 1}</td>
                    <td class="item-text">${item.text}</td>
                    <td>
                        <button class="edit-btn" onclick="startEdit(${item.id})">Edit</button>
                        <button class="delete-btn" onclick="deleteItem(${item.id})">×</button>
                    </td>
                </tr>
            `).join('');
            
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(html.replace('{{rows}}', rows));
            
        } else if (req.method === 'POST' && parsedUrl.pathname === '/items') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                const { text } = JSON.parse(body);
                await queryDB('INSERT INTO items (text, user_id) VALUES (?, ?)', [text, user.id]);
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({success: true}));
            });
            
        } else if (req.method === 'DELETE' && parsedUrl.pathname.startsWith('/items/')) {
            const id = parsedUrl.pathname.split('/')[2];
            const [item] = await queryDB('SELECT * FROM items WHERE id = ? AND user_id = ?', [id, user.id]);
            if (!item) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            
            await queryDB('DELETE FROM items WHERE id = ?', [id]);
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true}));
            
        } else if (req.method === 'PUT' && parsedUrl.pathname.startsWith('/items/')) {
            const id = parsedUrl.pathname.split('/')[2];
            const [item] = await queryDB('SELECT * FROM items WHERE id = ? AND user_id = ?', [id, user.id]);
            if (!item) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                const { text } = JSON.parse(body);
                await queryDB('UPDATE items SET text = ? WHERE id = ?', [text, id]);
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