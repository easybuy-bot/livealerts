<?php
declare(strict_types=1);
require_once __DIR__ . '/../config.php';

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

/** Create all tables. Safe to run repeatedly. */
function migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user','admin') NOT NULL DEFAULT 'user',
        status ENUM('active','blocked') NOT NULL DEFAULT 'active',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    $pdo->exec("CREATE TABLE IF NOT EXISTS products (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(160) NOT NULL UNIQUE,
        title VARCHAR(200) NOT NULL,
        category ENUM('overlay','script','tool') NOT NULL DEFAULT 'overlay',
        short_desc VARCHAR(300) NOT NULL DEFAULT '',
        description MEDIUMTEXT NULL,
        features TEXT NULL,
        price_label VARCHAR(60) NOT NULL DEFAULT 'Contact for access',
        image VARCHAR(500) NULL,
        is_activatable TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // access_keys = the 'API' the admin creates and hands to a user.
    // One key -> one user -> one product (overlay). Unique key_code.
    $pdo->exec("CREATE TABLE IF NOT EXISTS access_keys (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        key_code VARCHAR(64) NOT NULL UNIQUE,
        product_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NULL,
        status ENUM('active','suspended','expired') NOT NULL DEFAULT 'active',
        note VARCHAR(255) NULL,
        expires_at DATETIME NULL,
        created_by INT UNSIGNED NULL,
        activated_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), INDEX (product_id),
        CONSTRAINT fk_key_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // overlays = one live overlay instance per access key.
    // token = the secret used in the OBS Browser Source URL.
    $pdo->exec("CREATE TABLE IF NOT EXISTS overlays (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        access_key_id INT UNSIGNED NOT NULL UNIQUE,
        user_id INT UNSIGNED NOT NULL,
        product_id INT UNSIGNED NOT NULL,
        token CHAR(43) NOT NULL UNIQUE,
        source_type ENUM('youtube','demo') NOT NULL DEFAULT 'demo',
        yt_api_key VARCHAR(120) NULL,
        yt_video_id VARCHAR(40) NULL,
        settings MEDIUMTEXT NULL,
        live_chat_id VARCHAR(200) NULL,
        next_page_token VARCHAR(400) NULL,
        last_poll_at DATETIME NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        CONSTRAINT fk_ov_key FOREIGN KEY (access_key_id) REFERENCES access_keys(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // small message buffer per overlay so the browser source can poll over HTTP.
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        overlay_id INT UNSIGNED NOT NULL,
        payload MEDIUMTEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (overlay_id, id),
        CONSTRAINT fk_cm_ov FOREIGN KEY (overlay_id) REFERENCES overlays(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        actor VARCHAR(190) NULL,
        action VARCHAR(120) NOT NULL,
        detail VARCHAR(500) NULL,
        ip VARCHAR(60) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // ---- Incremental column upgrades (safe to run repeatedly) ----
    // MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so check first.
    add_column_if_missing($pdo, 'products', 'kind',
        "ALTER TABLE products ADD COLUMN kind ENUM('chat','custom') NOT NULL DEFAULT 'chat' AFTER category");
    add_column_if_missing($pdo, 'products', 'overlay_html',
        "ALTER TABLE products ADD COLUMN overlay_html MEDIUMTEXT NULL AFTER image");
    add_column_if_missing($pdo, 'products', 'overlay_schema',
        "ALTER TABLE products ADD COLUMN overlay_schema MEDIUMTEXT NULL AFTER overlay_html");
    // Custom-overlay version safety: keep the previous HTML/schema for one-click rollback.
    add_column_if_missing($pdo, 'products', 'overlay_prev_html',
        "ALTER TABLE products ADD COLUMN overlay_prev_html MEDIUMTEXT NULL AFTER overlay_schema");
    add_column_if_missing($pdo, 'products', 'overlay_prev_schema',
        "ALTER TABLE products ADD COLUMN overlay_prev_schema MEDIUMTEXT NULL AFTER overlay_prev_html");
    add_column_if_missing($pdo, 'products', 'overlay_version',
        "ALTER TABLE products ADD COLUMN overlay_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER overlay_prev_schema");
    add_column_if_missing($pdo, 'products', 'overlay_updated_at',
        "ALTER TABLE products ADD COLUMN overlay_updated_at DATETIME NULL AFTER overlay_version");

    // ---- Multi-overlay instances per access key -------------------------------
    // A shared chat source per access key so several overlays (e.g. one vertical
    // and one horizontal) consume ONE polled message stream instead of each
    // hammering the YouTube API. Created here; existing per-overlay source data
    // is backfilled into it below.
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_sources (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        access_key_id INT UNSIGNED NOT NULL UNIQUE,
        source_type ENUM('youtube','demo') NOT NULL DEFAULT 'demo',
        yt_api_key VARCHAR(120) NULL,
        yt_video_id VARCHAR(40) NULL,
        live_chat_id VARCHAR(200) NULL,
        next_page_token VARCHAR(400) NULL,
        last_poll_at DATETIME NULL,
        last_state VARCHAR(40) NULL,
        last_reason VARCHAR(80) NULL,
        last_message_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_cs_key FOREIGN KEY (access_key_id) REFERENCES access_keys(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // ---- Automatic channel mode (added v4.3) --------------------------------
    // The channel is the PERSISTENT connection; the live video + chat id are the
    // TEMPORARY current stream. Existing YouTube rows default to yt_mode='manual'
    // so nothing changes for them (full backward compatibility).
    add_column_if_missing($pdo, 'chat_sources', 'yt_mode',
        "ALTER TABLE chat_sources ADD COLUMN yt_mode VARCHAR(10) NOT NULL DEFAULT 'manual' AFTER source_type");
    add_column_if_missing($pdo, 'chat_sources', 'yt_channel_url',
        "ALTER TABLE chat_sources ADD COLUMN yt_channel_url VARCHAR(200) NULL AFTER yt_mode");
    add_column_if_missing($pdo, 'chat_sources', 'yt_channel_id',
        "ALTER TABLE chat_sources ADD COLUMN yt_channel_id VARCHAR(40) NULL AFTER yt_channel_url");
    add_column_if_missing($pdo, 'chat_sources', 'yt_channel_title',
        "ALTER TABLE chat_sources ADD COLUMN yt_channel_title VARCHAR(200) NULL AFTER yt_channel_id");
    add_column_if_missing($pdo, 'chat_sources', 'yt_uploads_playlist',
        "ALTER TABLE chat_sources ADD COLUMN yt_uploads_playlist VARCHAR(40) NULL AFTER yt_channel_title");
    add_column_if_missing($pdo, 'chat_sources', 'live_video_title',
        "ALTER TABLE chat_sources ADD COLUMN live_video_title VARCHAR(300) NULL AFTER live_chat_id");
    add_column_if_missing($pdo, 'chat_sources', 'live_status',
        "ALTER TABLE chat_sources ADD COLUMN live_status VARCHAR(20) NULL AFTER last_reason");
    add_column_if_missing($pdo, 'chat_sources', 'last_checked_at',
        "ALTER TABLE chat_sources ADD COLUMN last_checked_at DATETIME NULL AFTER last_message_at");

    // Per-instance metadata on overlays.
    add_column_if_missing($pdo, 'overlays', 'name',
        "ALTER TABLE overlays ADD COLUMN name VARCHAR(120) NULL AFTER product_id");
    add_column_if_missing($pdo, 'overlays', 'enabled',
        "ALTER TABLE overlays ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER name");
    add_column_if_missing($pdo, 'overlays', 'source_id',
        "ALTER TABLE overlays ADD COLUMN source_id INT UNSIGNED NULL AFTER enabled");

    // Allow many overlays per key: drop the UNIQUE index on access_key_id if it
    // still exists, replacing it with a plain index. Safe/idempotent.
    $u = $pdo->query("SELECT COUNT(*) c FROM information_schema.statistics
                       WHERE table_schema=DATABASE() AND table_name='overlays'
                         AND index_name='access_key_id' AND non_unique=0")->fetch();
    if ((int)($u['c'] ?? 0) > 0) {
        try { $pdo->exec("ALTER TABLE overlays DROP INDEX access_key_id, ADD INDEX idx_ov_key (access_key_id)"); }
        catch (Throwable $e) { /* older MySQL: leave as-is, still functional for 1 overlay */ }
    }

    backfill_chat_sources($pdo);

    // chat_messages become source-scoped so overlays that share a source read one
    // buffer. Keep overlay_id (now nullable, FK dropped) for backward reads.
    add_column_if_missing($pdo, 'chat_messages', 'source_id',
        "ALTER TABLE chat_messages ADD COLUMN source_id INT UNSIGNED NULL AFTER overlay_id, ADD INDEX idx_cm_src (source_id, id)");
    // Drop the cascade FK on overlay_id so deleting one overlay never wipes a
    // shared buffer, and allow overlay_id to be NULL for new source-only rows.
    $fk = $pdo->query("SELECT constraint_name FROM information_schema.key_column_usage
                       WHERE table_schema=DATABASE() AND table_name='chat_messages'
                         AND column_name='overlay_id' AND referenced_table_name IS NOT NULL")->fetch();
    if ($fk && !empty($fk['constraint_name'])) {
        try { $pdo->exec("ALTER TABLE chat_messages DROP FOREIGN KEY " . $fk['constraint_name']); } catch (Throwable $e) {}
    }
    try { $pdo->exec("ALTER TABLE chat_messages MODIFY overlay_id INT UNSIGNED NULL"); } catch (Throwable $e) {}
    // Backfill source_id from the owning overlay.
    $pdo->exec("UPDATE chat_messages cm JOIN overlays o ON o.id=cm.overlay_id
                SET cm.source_id=o.source_id WHERE cm.source_id IS NULL");

    // ---- Live Camera Studio product (added v5) ------------------------------
    // Entirely additive. Adds the camera product tables, widens the product
    // category/kind enums so a "camera" product can live alongside the existing
    // chat/custom overlays, and seeds the store product once. None of this
    // touches or migrates existing overlay/chat data.
    migrate_camera($pdo);
    seed_camera_product($pdo);

    // ---- YouTube Live Alerts product integration ---------------------------
    migrate_youtube_live($pdo);
    seed_youtube_live_product($pdo);
}


/**
 * Live Camera Studio schema. All tables are new and namespaced with a camera_
 * prefix, so nothing here can collide with the overlay/chat pipeline. Safe to
 * run repeatedly (CREATE TABLE IF NOT EXISTS + add_column_if_missing).
 */
function migrate_camera(PDO $pdo): void {
    // Widen product enums so the store can carry a camera product. MODIFY to a
    // superset is idempotent and never drops existing values.
    try {
        $pdo->exec("ALTER TABLE products MODIFY COLUMN category
                    ENUM('overlay','script','tool','camera') NOT NULL DEFAULT 'overlay'");
    } catch (Throwable $e) {}
    try {
        $pdo->exec("ALTER TABLE products MODIFY COLUMN kind
                    ENUM('chat','custom','camera') NOT NULL DEFAULT 'chat'");
    } catch (Throwable $e) {}

    // A studio = one tenant workspace, created when a user redeems a camera key.
    // obs_token is the secret in the OBS Browser Source URL (/obs.php?t=...).
    // The *_enabled / max_* columns are admin feature flags + limits per studio.
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_studios (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        access_key_id INT UNSIGNED NOT NULL UNIQUE,
        user_id INT UNSIGNED NOT NULL,
        product_id INT UNSIGNED NOT NULL,
        name VARCHAR(140) NOT NULL DEFAULT 'Camera Studio',
        obs_token CHAR(43) NOT NULL UNIQUE,
        active_scene_id INT UNSIGNED NULL,
        settings MEDIUMTEXT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        recording_enabled TINYINT(1) NOT NULL DEFAULT 1,
        ai_blur_enabled TINYINT(1) NOT NULL DEFAULT 1,
        webrtc_enabled TINYINT(1) NOT NULL DEFAULT 1,
        max_devices INT UNSIGNED NOT NULL DEFAULT 4,
        max_scenes INT UNSIGNED NOT NULL DEFAULT 12,
        max_bitrate_kbps INT UNSIGNED NOT NULL DEFAULT 8000,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        CONSTRAINT fk_cstudio_key FOREIGN KEY (access_key_id) REFERENCES access_keys(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Cameras registered inside a studio (DJI / RTMP / SRT / WebRTC ingest).
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_devices (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        name VARCHAR(140) NOT NULL,
        device_type ENUM('dji','rtmp','srt','webrtc','other') NOT NULL DEFAULT 'rtmp',
        model VARCHAR(120) NULL,
        ingest_protocol ENUM('rtmp','srt','whip') NOT NULL DEFAULT 'rtmp',
        stream_path VARCHAR(80) NOT NULL,
        status ENUM('offline','online','streaming','error') NOT NULL DEFAULT 'offline',
        processing_profile_id INT UNSIGNED NULL,
        audio_profile_id INT UNSIGNED NULL,
        last_seen_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_dev_path (stream_path),
        INDEX (studio_id), INDEX (user_id),
        CONSTRAINT fk_cdev_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Separate secret material. api_key = REST API bearer; stream_key = ingest
    // secret used in the RTMP/SRT URL. Secrets are stored hashed; a short prefix
    // is kept for display ("OVHCAM_ab12…"). scopes limits an api_key.
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_credentials (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        device_id INT UNSIGNED NULL,
        kind ENUM('api_key','stream_key') NOT NULL,
        label VARCHAR(140) NOT NULL DEFAULT '',
        secret_hash CHAR(64) NOT NULL,
        secret_prefix VARCHAR(24) NOT NULL,
        scopes VARCHAR(400) NOT NULL DEFAULT '',
        status ENUM('active','revoked') NOT NULL DEFAULT 'active',
        last_used_at DATETIME NULL,
        expires_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id), INDEX (kind), INDEX (secret_prefix),
        CONSTRAINT fk_ccred_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE,
        CONSTRAINT fk_ccred_dev FOREIGN KEY (device_id) REFERENCES camera_devices(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // A live stream session on a device.
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_streams (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        device_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        status ENUM('idle','starting','live','ended','error') NOT NULL DEFAULT 'idle',
        media_session VARCHAR(120) NULL,
        resolution VARCHAR(20) NULL,
        fps INT UNSIGNED NULL,
        bitrate_kbps INT UNSIGNED NULL,
        viewer_peak INT UNSIGNED NOT NULL DEFAULT 0,
        started_at DATETIME NULL,
        ended_at DATETIME NULL,
        last_reason VARCHAR(120) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id), INDEX (device_id, id),
        CONSTRAINT fk_cstream_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE,
        CONSTRAINT fk_cstream_dev FOREIGN KEY (device_id) REFERENCES camera_devices(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Scenes (compositions) inside a studio; exactly one active per studio.
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_scenes (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        name VARCHAR(140) NOT NULL,
        layout ENUM('single','pip','side','grid') NOT NULL DEFAULT 'single',
        sort_order INT NOT NULL DEFAULT 0,
        transition VARCHAR(30) NOT NULL DEFAULT 'cut',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id),
        CONSTRAINT fk_cscene_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Placed elements within a scene (camera feed, overlay, image, text).
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_scene_elements (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        scene_id INT UNSIGNED NOT NULL,
        studio_id INT UNSIGNED NOT NULL,
        element_type ENUM('camera','overlay','image','text') NOT NULL DEFAULT 'camera',
        device_id INT UNSIGNED NULL,
        label VARCHAR(140) NULL,
        x DECIMAL(6,3) NOT NULL DEFAULT 0,
        y DECIMAL(6,3) NOT NULL DEFAULT 0,
        w DECIMAL(6,3) NOT NULL DEFAULT 100,
        h DECIMAL(6,3) NOT NULL DEFAULT 100,
        z_index INT NOT NULL DEFAULT 0,
        props MEDIUMTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (scene_id), INDEX (studio_id),
        CONSTRAINT fk_celem_scene FOREIGN KEY (scene_id) REFERENCES camera_scenes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Privacy blur zones per device (fixed regions the AI worker must blur).
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_privacy_zones (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        device_id INT UNSIGNED NOT NULL,
        name VARCHAR(140) NOT NULL DEFAULT 'Zone',
        shape ENUM('rect','ellipse') NOT NULL DEFAULT 'rect',
        x DECIMAL(6,3) NOT NULL DEFAULT 0,
        y DECIMAL(6,3) NOT NULL DEFAULT 0,
        w DECIMAL(6,3) NOT NULL DEFAULT 20,
        h DECIMAL(6,3) NOT NULL DEFAULT 20,
        blur_strength TINYINT UNSIGNED NOT NULL DEFAULT 20,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id), INDEX (device_id),
        CONSTRAINT fk_czone_dev FOREIGN KEY (device_id) REFERENCES camera_devices(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Video processing profiles (resolution/bitrate/codec + AI face blur).
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_processing_profiles (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        name VARCHAR(140) NOT NULL DEFAULT 'Default',
        resolution VARCHAR(20) NOT NULL DEFAULT '1920x1080',
        fps INT UNSIGNED NOT NULL DEFAULT 30,
        bitrate_kbps INT UNSIGNED NOT NULL DEFAULT 4500,
        codec VARCHAR(20) NOT NULL DEFAULT 'h264',
        face_blur_enabled TINYINT(1) NOT NULL DEFAULT 0,
        face_blur_strength TINYINT UNSIGNED NOT NULL DEFAULT 25,
        denoise TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id),
        CONSTRAINT fk_cprof_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Audio profiles.
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_audio_profiles (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        name VARCHAR(140) NOT NULL DEFAULT 'Default',
        source VARCHAR(120) NOT NULL DEFAULT 'camera',
        gain_db DECIMAL(5,2) NOT NULL DEFAULT 0,
        noise_suppression TINYINT(1) NOT NULL DEFAULT 1,
        echo_cancel TINYINT(1) NOT NULL DEFAULT 0,
        muted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id),
        CONSTRAINT fk_caud_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Recordings.
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_recordings (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        stream_id INT UNSIGNED NULL,
        device_id INT UNSIGNED NULL,
        filename VARCHAR(255) NOT NULL,
        status ENUM('recording','processing','ready','failed') NOT NULL DEFAULT 'recording',
        duration_s INT UNSIGNED NULL,
        size_bytes BIGINT UNSIGNED NULL,
        url VARCHAR(500) NULL,
        started_at DATETIME NULL,
        ended_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id),
        CONSTRAINT fk_crec_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Snapshots (still frames).
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_snapshots (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        device_id INT UNSIGNED NULL,
        stream_id INT UNSIGNED NULL,
        filename VARCHAR(255) NOT NULL,
        url VARCHAR(500) NULL,
        taken_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id),
        CONSTRAINT fk_csnap_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Time-series analytics counters (viewers, bitrate, dropped frames, etc.).
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_analytics (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NOT NULL,
        stream_id INT UNSIGNED NULL,
        metric VARCHAR(40) NOT NULL,
        value DOUBLE NOT NULL DEFAULT 0,
        meta VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id, metric, id),
        CONSTRAINT fk_canalytic_studio FOREIGN KEY (studio_id) REFERENCES camera_studios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    // Inbound (media-server callbacks) + outbound webhook event log.
    $pdo->exec("CREATE TABLE IF NOT EXISTS camera_webhooks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        studio_id INT UNSIGNED NULL,
        direction ENUM('in','out') NOT NULL DEFAULT 'in',
        event VARCHAR(60) NOT NULL,
        url VARCHAR(500) NULL,
        payload MEDIUMTEXT NULL,
        status VARCHAR(40) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (studio_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
}

/** Seed the Live Camera Studio store product once (idempotent by slug). */
function seed_camera_product(PDO $pdo): void {
    $exists = (int)$pdo->query("SELECT COUNT(*) c FROM products WHERE slug='live-camera-studio'")
                        ->fetch()['c'];
    if ($exists > 0) return;
    $sort = (int)$pdo->query("SELECT COALESCE(MAX(sort_order),0)+1 s FROM products")->fetch()['s'];
    $st = $pdo->prepare("INSERT INTO products
        (slug,title,category,kind,short_desc,description,features,price_label,is_activatable,active,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    $st->execute([
        'live-camera-studio',
        'Live Camera Studio',
        'camera',
        'camera',
        'Turn a DJI / RTMP camera into a clean OBS-ready live source with scenes, privacy blur and recording.',
        "Live Camera Studio ingests your DJI or any RTMP/SRT camera, processes it (resolution, bitrate, AI face blur, privacy zones), and gives you a single clean OBS Browser Source URL. Build scenes, switch them live without touching OBS, record, snapshot and watch real-time analytics.",
        "DJI / RTMP / SRT camera ingest\nOne clean OBS output URL (no re-setup)\nLive scene switching (single / PiP / side / grid)\nAI face blur + fixed privacy zones\nProcessing profiles (resolution, bitrate, codec)\nAudio profiles (gain, noise suppression)\nRecording, snapshots & replay\nWebRTC low-latency preview\nScoped REST API keys\nReal-time analytics",
        'Included with your key',
        1, 1, $sort,
    ]);
}

/**
 * Create one chat_sources row per access key that has overlays, seeding it from
 * the (historically per-overlay) source columns, and point every overlay of that
 * key at the shared source. Idempotent: only creates/links what is missing.
 */
function backfill_chat_sources(PDO $pdo): void {
    // Keys that have overlays but no chat_sources row yet.
    $rows = $pdo->query("SELECT o.access_key_id,
                                MAX(o.source_type) src, MAX(o.yt_api_key) k, MAX(o.yt_video_id) v,
                                MAX(o.live_chat_id) lc, MAX(o.next_page_token) np, MAX(o.last_poll_at) lp
                         FROM overlays o
                         LEFT JOIN chat_sources cs ON cs.access_key_id=o.access_key_id
                         WHERE cs.id IS NULL
                         GROUP BY o.access_key_id")->fetchAll();
    $ins = $pdo->prepare("INSERT INTO chat_sources
        (access_key_id, source_type, yt_api_key, yt_video_id, live_chat_id, next_page_token, last_poll_at)
        VALUES (?,?,?,?,?,?,?)");
    foreach ($rows as $r) {
        $ins->execute([$r['access_key_id'], $r['src'] ?: 'demo', $r['k'], $r['v'], $r['lc'], $r['np'], $r['lp']]);
    }
    // Link overlays to their key's source where not linked yet.
    $pdo->exec("UPDATE overlays o JOIN chat_sources cs ON cs.access_key_id=o.access_key_id
                SET o.source_id=cs.id WHERE o.source_id IS NULL");
}


/** YouTube Live Alerts schema, owned by canonical users.id and licensed via products/access_keys. */
function migrate_youtube_live(PDO $pdo): void {
    try { $pdo->exec("ALTER TABLE products MODIFY COLUMN category ENUM('overlay','script','tool','camera','youtube') NOT NULL DEFAULT 'overlay'"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE products MODIFY COLUMN kind ENUM('chat','custom','camera','youtube_live') NOT NULL DEFAULT 'chat'"); } catch (Throwable $e) {}
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_connections (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL UNIQUE,
        google_user_id VARCHAR(120) NULL, channel_id VARCHAR(120) NULL, channel_title VARCHAR(255) NULL,
        channel_thumbnail VARCHAR(500) NULL, subscriber_count BIGINT UNSIGNED NULL,
        access_token_enc TEXT NULL, refresh_token_enc TEXT NULL, token_expires_at DATETIME NULL, scopes TEXT NULL,
        state ENUM('OFFLINE','CONNECTING','READY','LIVE','ERROR') NOT NULL DEFAULT 'OFFLINE',
        live_video_id VARCHAR(80) NULL, live_chat_id VARCHAR(200) NULL, live_title VARCHAR(300) NULL,
        last_live_check DATETIME NULL, last_event_poll DATETIME NULL, last_error VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_ytc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_overlays (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL, name VARCHAR(140) NOT NULL DEFAULT 'YouTube Live Overlay',
        token CHAR(43) NOT NULL UNIQUE, width INT UNSIGNED NOT NULL DEFAULT 1920, height INT UNSIGNED NOT NULL DEFAULT 1080,
        orientation VARCHAR(20) NOT NULL DEFAULT '16:9', settings MEDIUMTEXT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX(user_id), CONSTRAINT fk_yto_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_templates (id VARCHAR(80) PRIMARY KEY, slug VARCHAR(160) UNIQUE NOT NULL, name VARCHAR(200) NOT NULL, event_type VARCHAR(60) NOT NULL, category VARCHAR(80), configuration MEDIUMTEXT NOT NULL, is_system TINYINT(1) NOT NULL DEFAULT 1, is_premium TINYINT(1) NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'active', sort_order INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_user_templates (id VARCHAR(80) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, source_template_id VARCHAR(80) NULL, name VARCHAR(200) NOT NULL, event_type VARCHAR(60) NOT NULL, configuration MEDIUMTEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX(user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_alert_assignments (id VARCHAR(80) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, overlay_id INT UNSIGNED NOT NULL, event_type VARCHAR(60) NOT NULL, user_template_id VARCHAR(80) NOT NULL, priority INT NOT NULL DEFAULT 1, conditions MEDIUMTEXT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX(user_id), INDEX(overlay_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_media (id VARCHAR(80) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, kind VARCHAR(40) NOT NULL, filename VARCHAR(255) NOT NULL, mime VARCHAR(120), size BIGINT UNSIGNED, path VARCHAR(500) NOT NULL, url VARCHAR(500) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX(user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_events (id VARCHAR(80) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, overlay_id INT UNSIGNED NULL, connection_id INT UNSIGNED NULL, event_type VARCHAR(60) NOT NULL, username VARCHAR(200), amount DECIMAL(12,2), currency VARCHAR(10), message TEXT, payload MEDIUMTEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX(user_id), INDEX(event_type)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_milestones (id VARCHAR(80) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, threshold_value BIGINT UNSIGNED NOT NULL, user_template_id VARCHAR(80), enabled TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX(user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    $pdo->exec("CREATE TABLE IF NOT EXISTS youtube_live_oauth_states (state VARCHAR(128) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, INDEX(user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
}

function seed_youtube_live_product(PDO $pdo): void {
    if ((int)$pdo->query("SELECT COUNT(*) c FROM products WHERE slug='youtube-live-alerts'")->fetch()['c'] > 0) return;
    $sort = (int)$pdo->query("SELECT COALESCE(MAX(sort_order),0)+1 s FROM products")->fetch()['s'];
    $st=$pdo->prepare("INSERT INTO products (slug,title,category,kind,short_desc,description,features,price_label,is_activatable,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    $st->execute(['youtube-live-alerts','YouTube Live Alerts','youtube','youtube_live','Professional YouTube Live alerts for OBS.','Super Chat, stickers, members, subscribers, milestones, animated templates, alert builder and secure OBS Browser Source.','Super Chat\nSuper Sticker\nMembers and gift memberships\nSubscribers\nLive Start/End\nMilestones\nAnimated templates\nCustom alert builder\nBrowser Source for OBS','Included with your key',1,1,$sort]);
}

/** Add a column only when it does not already exist. */
function add_column_if_missing(PDO $pdo, string $table, string $column, string $ddl): void {
    $st = $pdo->prepare(
        "SELECT COUNT(*) c FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?"
    );
    $st->execute([$table, $column]);
    if ((int)$st->fetch()['c'] === 0) $pdo->exec($ddl);
}
