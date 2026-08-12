// Cargar variables de entorno desde archivo .env (solo en desarrollo)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const rateLimit = require('express-rate-limit');

// Cloudinary
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'tu_cloud_name',
    api_key: process.env.CLOUDINARY_API_KEY || 'tu_api_key',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'tu_api_secret'
});

const app = express();
const PORT = process.env.PORT || 3000;

// Validar variables críticas
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('ERROR CRÍTICO: La variable de entorno JWT_SECRET no está definida.');
    console.error('Debes configurar un valor seguro para JWT_SECRET antes de iniciar el servidor.');
    process.exit(1);
}

const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
    console.error('ERROR CRÍTICO: La variable de entorno ADMIN_KEY no está definida.');
    console.error('Debes configurar una clave de administración segura antes de iniciar el servidor.');
    process.exit(1);
}

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Middleware
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Limitar peticiones a la API
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 200, // máximo 200 peticiones por ventana por IP
    message: { error: 'Demasiadas peticiones, por favor intenta de nuevo más tarde.' }
});
app.use('/api/', limiter);

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: CORS_ORIGIN } });

// Base de datos
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Error al conectar con SQLite:', err.message);
    else console.log('Conectado a SQLite.');
});

// Crear tablas
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        tipo TEXT,
        estado TEXT,
        fecha_registro TEXT DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS materiales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material TEXT NOT NULL,
        presentacion TEXT,
        origen TEXT,
        color TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reportes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_id INTEGER NOT NULL,
        precio_kg REAL NOT NULL,
        estado TEXT NOT NULL,
        municipio TEXT,
        volumen_ton REAL DEFAULT 1,
        tipo_operacion TEXT NOT NULL,
        contaminacion TEXT,
        fecha TEXT NOT NULL,
        usuario TEXT NOT NULL,
        verificado BOOLEAN DEFAULT 1
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS marketplace (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_email TEXT NOT NULL,
        usuario_nombre TEXT,
        tipo TEXT NOT NULL,
        material_id INTEGER,
        presentacion TEXT,
        origen TEXT,
        color TEXT,
        precio_kg REAL,
        volumen_ton REAL,
        estado TEXT,
        municipio TEXT,
        garantia TEXT,
        descripcion TEXT,
        foto TEXT,
        activo BOOLEAN DEFAULT 1,
        es_atipico BOOLEAN DEFAULT 0,
        fecha TEXT DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS calificaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_email TEXT,
        from_name TEXT,
        to_email TEXT,
        rating INTEGER,
        comment TEXT,
        fecha TEXT DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS ofertas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publicacion_id INTEGER,
        comprador_email TEXT,
        vendedor_email TEXT,
        vendedor_nombre TEXT,
        precio REAL,
        volumen REAL,
        mensaje TEXT,
        estado TEXT DEFAULT 'pendiente',
        fecha TEXT DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS alertas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_email TEXT,
        material_id INTEGER,
        estado TEXT,
        precio_objetivo REAL,
        condicion TEXT,
        activa BOOLEAN DEFAULT 1
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sugerencias_materiales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material TEXT,
        presentacion TEXT,
        origen TEXT,
        color TEXT,
        estado TEXT DEFAULT 'pendiente',
        fecha TEXT DEFAULT (datetime('now')),
        usuario TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reportes_vendedor (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_email TEXT,
        reported_email TEXT,
        motivo TEXT,
        descripcion TEXT,
        fecha TEXT DEFAULT (datetime('now'))
    )`);

    // Insertar materiales base si la tabla está vacía
    db.get(`SELECT COUNT(*) as count FROM materiales`, (err, row) => {
        if (row && row.count === 0) {
            const base = [
                { id:1, material:'ABS', presentacion:'Molido', origen:'Post-Industrial', color:'Blanco Natural' },
                { id:2, material:'ABS', presentacion:'Molido', origen:'Post-Industrial', color:'Blanco Roto' },
                { id:3, material:'PP Homopolímero', presentacion:'Molido', origen:'Post-Industrial', color:'Blanco' },
                { id:4, material:'PP Copolímero', presentacion:'Molido', origen:'Post-Industrial', color:'Blanco' },
                { id:5, material:'PP Virgen Off-Spec', presentacion:'Peletizado', origen:'Virgen Off-Spec', color:'Blanco' },
                { id:6, material:'ABS', presentacion:'Peletizado', origen:'Post-Industrial', color:'Blanco' },
                { id:7, material:'PP Homopolímero', presentacion:'Hojuela', origen:'Post-Consumo', color:'Blanco' },
                { id:8, material:'PP Copolímero', presentacion:'Molido', origen:'Post-Consumo', color:'Blanco Roto' }
            ];
            const stmt = db.prepare(`INSERT INTO materiales (id,material,presentacion,origen,color) VALUES (?,?,?,?,?)`);
            base.forEach(m => stmt.run(m.id, m.material, m.presentacion, m.origen, m.color));
            stmt.finalize();
        }
    });
});

// Middleware de autenticación
const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Token requerido' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = decoded;
        next();
    });
};

// Middleware de admin
const verificarAdmin = (req, res, next) => {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Acceso denegado' });
    next();
};

// ------------------- AUTH -------------------
app.post('/api/registro', async (req, res) => {
    const { nombre, email, password, tipo, estado } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos obligatorios' });
    try {
        const hashed = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO usuarios (nombre, email, password, tipo, estado) VALUES (?,?,?,?,?)`,
            [nombre, email, hashed, tipo, estado],
            function(err) {
                if (err) return res.status(400).json({ error: 'Email ya registrado o error en BD' });
                const token = jwt.sign({ id: this.lastID, email, nombre }, JWT_SECRET);
                res.json({ token, user: { id: this.lastID, nombre, email, tipo, estado } });
            });
    } catch (e) {
        res.status(500).json({ error: 'Error al registrar' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Credenciales incorrectas' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Credenciales incorrectas' });
        const token = jwt.sign({ id: user.id, email: user.email, nombre: user.nombre }, JWT_SECRET);
        res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, tipo: user.tipo, estado: user.estado } });
    });
});

// ------------------- MATERIALES -------------------
app.get('/api/materiales', (req, res) => {
    db.all(`SELECT * FROM materiales`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ------------------- REPORTES -------------------
app.get('/api/reportes', (req, res) => {
    db.all(`SELECT * FROM reportes WHERE fecha >= date('now','-30 days') ORDER BY fecha DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/reportes', verificarToken, (req, res) => {
    const { material_id, precio_kg, estado, municipio, volumen_ton, tipo_operacion, contaminacion, fecha, verificado } = req.body;
    const usuario = req.user.nombre;
    db.run(`INSERT INTO reportes (material_id, precio_kg, estado, municipio, volumen_ton, tipo_operacion, contaminacion, fecha, usuario, verificado) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [material_id, precio_kg, estado, municipio, volumen_ton, tipo_operacion, contaminacion, fecha, usuario, verificado ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('nuevo_reporte', { mensaje: `Nuevo reporte de ${material_id} en ${estado}` });
            res.json({ id: this.lastID, mensaje: 'Reporte creado' });
        });
});

// ------------------- MARKETPLACE -------------------
app.get('/api/marketplace', (req, res) => {
    db.all(`SELECT * FROM marketplace WHERE activo = 1 ORDER BY fecha DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/marketplace', verificarToken, (req, res) => {
    const pub = req.body;
    db.run(`INSERT INTO marketplace (usuario_email, usuario_nombre, tipo, material_id, presentacion, origen, color, precio_kg, volumen_ton, estado, municipio, garantia, descripcion, foto, es_atipico) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.user.email, req.user.nombre, pub.tipo, pub.material_id, pub.presentacion, pub.origen, pub.color, pub.precio_kg, pub.volumen_ton, pub.estado, pub.municipio, pub.garantia, pub.descripcion, pub.foto, pub.es_atipico || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('nueva_publicacion', { mensaje: `Nueva publicación de ${req.user.nombre}` });
            res.json({ id: this.lastID });
        });
});

app.put('/api/marketplace/:id', verificarToken, (req, res) => {
    const { id } = req.params;
    const pub = req.body;
    db.run(`UPDATE marketplace SET tipo=?, material_id=?, presentacion=?, origen=?, color=?, precio_kg=?, volumen_ton=?, estado=?, municipio=?, garantia=?, descripcion=?, foto=?, es_atipico=? WHERE id=? AND usuario_email=?`,
        [pub.tipo, pub.material_id, pub.presentacion, pub.origen, pub.color, pub.precio_kg, pub.volumen_ton, pub.estado, pub.municipio, pub.garantia, pub.descripcion, pub.foto, pub.es_atipico || 0, id, req.user.email],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.delete('/api/marketplace/:id', verificarToken, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE marketplace SET activo = 0 WHERE id = ? AND usuario_email = ?`, [id, req.user.email], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ------------------- UPLOAD DE IMAGEN (CLOUDINARY) -------------------
app.post('/api/upload', verificarToken, async (req, res) => {
    try {
        const fileStr = req.body.image;
        const uploadResponse = await cloudinary.uploader.upload(fileStr);
        res.json({ url: uploadResponse.secure_url });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al subir imagen' });
    }
});

// ------------------- CALIFICACIONES -------------------
app.get('/api/calificaciones/todas', (req, res) => {
    db.all(`SELECT * FROM calificaciones`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/calificaciones/:email', (req, res) => {
    db.all(`SELECT * FROM calificaciones WHERE to_email = ? ORDER BY fecha DESC`, [req.params.email], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/calificaciones', verificarToken, (req, res) => {
    const { toEmail, rating, comment } = req.body;
    db.run(`INSERT INTO calificaciones (from_email, from_name, to_email, rating, comment) VALUES (?,?,?,?,?)`,
        [req.user.email, req.user.nombre, toEmail, rating, comment],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        });
});

// ------------------- OFERTAS -------------------
app.get('/api/ofertas/recibidas', verificarToken, (req, res) => {
    db.all(`SELECT * FROM ofertas WHERE comprador_email = ? ORDER BY fecha DESC`, [req.user.email], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/ofertas/enviadas', verificarToken, (req, res) => {
    db.all(`SELECT * FROM ofertas WHERE vendedor_email = ? ORDER BY fecha DESC`, [req.user.email], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/ofertas', verificarToken, (req, res) => {
    const { publicacionId, compradorEmail, precio, volumen, mensaje } = req.body;
    db.run(`INSERT INTO ofertas (publicacion_id, comprador_email, vendedor_email, vendedor_nombre, precio, volumen, mensaje) VALUES (?,?,?,?,?,?,?)`,
        [publicacionId, compradorEmail, req.user.email, req.user.nombre, precio, volumen, mensaje],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        });
});

app.put('/api/ofertas/:id/aceptar', verificarToken, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE ofertas SET estado = 'aceptada' WHERE id = ? AND comprador_email = ?`, [id, req.user.email], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`UPDATE ofertas SET estado = 'rechazada' WHERE publicacion_id = (SELECT publicacion_id FROM ofertas WHERE id = ?) AND id != ? AND estado = 'pendiente'`, [id, id]);
        res.json({ success: true });
    });
});

app.put('/api/ofertas/:id/rechazar', verificarToken, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE ofertas SET estado = 'rechazada' WHERE id = ? AND comprador_email = ?`, [id, req.user.email], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ------------------- ALERTAS -------------------
app.get('/api/alertas', verificarToken, (req, res) => {
    db.all(`SELECT * FROM alertas WHERE usuario_email = ?`, [req.user.email], (err, rows) => res.json(rows));
});

app.post('/api/alertas', verificarToken, (req, res) => {
    const { material_id, estado, precio_objetivo, condicion } = req.body;
    db.run(`INSERT INTO alertas (usuario_email, material_id, estado, precio_objetivo, condicion) VALUES (?,?,?,?,?)`,
        [req.user.email, material_id, estado, precio_objetivo, condicion],
        function(err) { res.json({ id: this.lastID }); });
});

app.delete('/api/alertas/:id', verificarToken, (req, res) => {
    db.run(`DELETE FROM alertas WHERE id = ? AND usuario_email = ?`, [req.params.id, req.user.email], function(err) {
        res.json({ success: true });
    });
});

// ------------------- REPORTES DE VENDEDORES -------------------
app.get('/api/reportes-vendedor', (req, res) => {
    db.all(`SELECT * FROM reportes_vendedor ORDER BY fecha DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/reportes-vendedor', verificarToken, (req, res) => {
    const { reportedEmail, motivo, descripcion } = req.body;
    db.run(`INSERT INTO reportes_vendedor (reporter_email, reported_email, motivo, descripcion) VALUES (?,?,?,?)`,
        [req.user.email, reportedEmail, motivo, descripcion],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        });
});

// ------------------- SUGERENCIAS MATERIALES -------------------
app.post('/api/sugerencias-materiales', verificarToken, (req, res) => {
    const { material, presentacion, origen, color } = req.body;
    db.run(`INSERT INTO sugerencias_materiales (material, presentacion, origen, color, usuario) VALUES (?,?,?,?,?)`,
        [material, presentacion, origen, color, req.user.nombre],
        function(err) { res.json({ id: this.lastID }); });
});

app.get('/api/sugerencias-materiales', (req, res) => {
    db.all(`SELECT * FROM sugerencias_materiales WHERE estado = 'pendiente'`, (err, rows) => res.json(rows));
});

app.put('/api/sugerencias-materiales/:id/aprobar', verificarToken, (req, res) => {
    db.get(`SELECT * FROM sugerencias_materiales WHERE id = ?`, [req.params.id], (err, sugerencia) => {
        if (!sugerencia) return res.status(404).json({ error: 'No encontrada' });
        db.run(`INSERT INTO materiales (material, presentacion, origen, color) VALUES (?,?,?,?)`,
            [sugerencia.material, sugerencia.presentacion, sugerencia.origen, sugerencia.color],
            function() {
                db.run(`UPDATE sugerencias_materiales SET estado = 'aprobada' WHERE id = ?`, [req.params.id]);
                res.json({ success: true, materialId: this.lastID });
            });
    });
});

app.put('/api/sugerencias-materiales/:id/rechazar', verificarToken, (req, res) => {
    db.run(`UPDATE sugerencias_materiales SET estado = 'rechazada' WHERE id = ?`, [req.params.id], function(err) {
        res.json({ success: true });
    });
});

// ------------------- ADMINISTRACIÓN -------------------
app.get('/api/admin/reportes', verificarAdmin, (req, res) => {
    db.all(`SELECT reportes.*, materiales.material FROM reportes LEFT JOIN materiales ON reportes.material_id = materiales.id ORDER BY reportes.fecha DESC`, (err, rows) => res.json(rows));
});

app.delete('/api/admin/reportes/:id', verificarAdmin, (req, res) => {
    db.run(`DELETE FROM reportes WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/admin/marketplace', verificarAdmin, (req, res) => {
    db.all(`SELECT marketplace.*, materiales.material FROM marketplace LEFT JOIN materiales ON marketplace.material_id = materiales.id ORDER BY marketplace.fecha DESC`, (err, rows) => res.json(rows));
});

app.delete('/api/admin/marketplace/:id', verificarAdmin, (req, res) => {
    db.run(`DELETE FROM marketplace WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/admin/usuarios', verificarAdmin, (req, res) => {
    db.all(`SELECT id, nombre, email, tipo, estado, fecha_registro FROM usuarios`, (err, rows) => res.json(rows));
});

// ------------------- CATCH-ALL PARA SPA -------------------
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));