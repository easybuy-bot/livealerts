<?php
declare(strict_types=1);
require_once __DIR__ . '/../inc/helpers.php';

/**
 * Live Camera Studio — tenant-scoped model.
 *
 * Every public read/write is scoped by user_id (ownership) or by a hashed
 * credential, so User A can never touch User B's studio, devices, scenes,
 * credentials, recordings, streams or OBS output. Secrets (api_key/stream_key)
 * are generated with random_bytes and stored only as SHA-256 hashes; the raw
 * value is returned exactly once at creation time.
 *
 * The class is deliberately free of any media/transport code. Starting or
 * stopping the actual RTMP/WebRTC pipeline is delegated to lib/MediaServer.php
 * (a thin integration seam); this class only owns the application state.
 */
final class Camera {

    /** All API scopes an api_key credential can hold. */
    public const SCOPES = [
        'camera:read'   => 'Read studio, devices and scenes',
        'camera:write'  => 'Create / edit devices and scenes',
        'stream:start'  => 'Start a stream session',
        'stream:stop'   => 'Stop a stream session',
        'scene:switch'  => 'Switch the active scene',
        'snapshot'      => 'Capture snapshots',
        'recording'     => 'Start / stop recordings',
        'analytics'     => 'Read analytics',
    ];

    /* ---------------- Access / provisioning ---------------- */

    /**
     * Redeem a camera access key -> provision a studio for the user.
     * Mirrors Overlay::redeem semantics: returns the existing studio if the key
     * was already activated (idempotent), otherwise creates a fresh one.
     */
    public static function redeem(string $keyCode, int $userId): array {
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('SELECT * FROM access_keys WHERE key_code = ? LIMIT 1 FOR UPDATE');
            $st->execute([$keyCode]);
            $key = $st->fetch();
            if (!$key)                        throw new RuntimeException('This API key was not found. Check for typos.');
            if ($key['status'] !== 'active')  throw new RuntimeException('This API key is ' . $key['status'] . '.');
            if ($key['expires_at'] !== null && strtotime($key['expires_at']) < time())
                                              throw new RuntimeException('This API key has expired.');
            if ($key['user_id'] !== null && (int)$key['user_id'] !== $userId)
                                              throw new RuntimeException('This API key is already assigned to another account.');

            // Confirm this key is actually for a camera product.
            $prod = $pdo->prepare('SELECT id,title,kind FROM products WHERE id=? LIMIT 1');
            $prod->execute([$key['product_id']]);
            $product = $prod->fetch();
            if (!$product || $product['kind'] !== 'camera')
                throw new RuntimeException('This key is not a Live Camera Studio key.');

            $ex = $pdo->prepare('SELECT id FROM camera_studios WHERE access_key_id=? LIMIT 1');
            $ex->execute([$key['id']]);
            if ($row = $ex->fetch()) { $pdo->commit(); return ['studio_id' => (int)$row['id'], 'new' => false]; }

            if ($key['user_id'] === null) {
                $pdo->prepare('UPDATE access_keys SET user_id=?, activated_at=NOW() WHERE id=?')
                    ->execute([$userId, $key['id']]);
            }
            $sid = self::createStudio($pdo, (int)$key['id'], $userId, (int)$key['product_id'],
                                      $product['title'] . ' Studio');
            $pdo->commit();
            return ['studio_id' => $sid, 'new' => true];
        } catch (Throwable $ex) {
            $pdo->rollBack();
            throw $ex;
        }
    }

    /** Provision a studio with sensible defaults (scene + profiles + creds). */
    public static function createStudio(PDO $pdo, int $accessKeyId, int $userId,
                                        int $productId, string $name): int {
        $ins = $pdo->prepare('INSERT INTO camera_studios
            (access_key_id,user_id,product_id,name,obs_token) VALUES (?,?,?,?,?)');
        $ins->execute([$accessKeyId, $userId, $productId, $name, gen_token()]);
        $sid = (int)$pdo->lastInsertId();

        // Default processing + audio profile.
        $pdo->prepare('INSERT INTO camera_processing_profiles (studio_id,name) VALUES (?,?)')
            ->execute([$sid, 'Default 1080p']);
        $pdo->prepare('INSERT INTO camera_audio_profiles (studio_id,name) VALUES (?,?)')
            ->execute([$sid, 'Default audio']);

        // Default scene, marked active.
        $pdo->prepare('INSERT INTO camera_scenes (studio_id,user_id,name,layout,sort_order) VALUES (?,?,?,?,0)')
            ->execute([$sid, $userId, 'Main', 'single']);
        $sceneId = (int)$pdo->lastInsertId();
        $pdo->prepare('UPDATE camera_studios SET active_scene_id=? WHERE id=?')->execute([$sceneId, $sid]);

        // One default API key + one stream key (raw values only logged, not kept).
        self::createCredential($pdo, $sid, $userId, 'api_key', 'Default API key',
            array_keys(self::SCOPES), null);
        self::createCredential($pdo, $sid, $userId, 'stream_key', 'Default stream key', [], null);

        return $sid;
    }

    /* ---------------- Ownership-scoped reads ---------------- */

    public static function studiosForUser(int $userId): array {
        $st = db()->prepare("SELECT s.*, p.title AS product_title, k.key_code, k.status AS key_status, k.expires_at
                             FROM camera_studios s
                             JOIN products p ON p.id=s.product_id
                             JOIN access_keys k ON k.id=s.access_key_id
                             WHERE s.user_id=? ORDER BY s.id");
        $st->execute([$userId]);
        return $st->fetchAll();
    }

    /** Find a studio by id, enforcing ownership. Returns null if not owned. */
    public static function find(int $id, int $userId): ?array {
        $st = db()->prepare("SELECT s.*, p.title AS product_title, k.key_code, k.status AS key_status, k.expires_at
                             FROM camera_studios s
                             JOIN products p ON p.id=s.product_id
                             JOIN access_keys k ON k.id=s.access_key_id
                             WHERE s.id=? AND s.user_id=? LIMIT 1");
        $st->execute([$id, $userId]);
        return $st->fetch() ?: null;
    }

    /** Find a studio by its OBS output token (public, unguessable). */
    public static function findByObsToken(string $token): ?array {
        if ($token === '') return null;
        $st = db()->prepare("SELECT * FROM camera_studios WHERE obs_token=? LIMIT 1");
        $st->execute([$token]);
        return $st->fetch() ?: null;
    }

    /** Convenience: load a studio for a user or throw a 404-ish exception. */
    public static function require(int $id, int $userId): array {
        $s = self::find($id, $userId);
        if (!$s) throw new RuntimeException('Studio not found.');
        return $s;
    }

    /* ---------------- Credentials ---------------- */

    private static function rawSecret(string $kind): string {
        // Distinct, greppable prefixes make leaks easy to spot & rotate.
        $p = $kind === 'api_key' ? 'ovhk_' : 'ovhs_';
        return $p . rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    }

    public static function hashSecret(string $raw): string { return hash('sha256', $raw); }

    /**
     * Create a credential. Returns ['id','raw'] — raw shown once only.
     * $scopes only meaningful for api_key.
     */
    public static function createCredential(PDO $pdo, int $studioId, int $userId, string $kind,
                                            string $label, array $scopes = [],
                                            ?int $deviceId = null, ?string $expiresAt = null): array {
        $raw    = self::rawSecret($kind);
        $hash   = self::hashSecret($raw);
        $prefix = substr($raw, 0, 12);
        $scopeStr = $kind === 'api_key' ? implode(' ', array_values(array_intersect(array_keys(self::SCOPES), $scopes))) : '';
        $ins = $pdo->prepare('INSERT INTO camera_credentials
            (studio_id,user_id,device_id,kind,label,secret_hash,secret_prefix,scopes,expires_at)
            VALUES (?,?,?,?,?,?,?,?,?)');
        $ins->execute([$studioId, $userId, $deviceId, $kind, $label, $hash, $prefix, $scopeStr, $expiresAt]);
        return ['id' => (int)$pdo->lastInsertId(), 'raw' => $raw];
    }

    public static function credentials(int $studioId, int $userId, ?string $kind = null): array {
        $sql = "SELECT id,kind,label,secret_prefix,scopes,status,last_used_at,expires_at,created_at,device_id
                FROM camera_credentials WHERE studio_id=? AND user_id=?";
        $args = [$studioId, $userId];
        if ($kind !== null) { $sql .= " AND kind=?"; $args[] = $kind; }
        $sql .= " ORDER BY id";
        $st = db()->prepare($sql); $st->execute($args);
        return $st->fetchAll();
    }

    public static function revokeCredential(int $credId, int $studioId, int $userId): bool {
        $st = db()->prepare("UPDATE camera_credentials SET status='revoked'
                             WHERE id=? AND studio_id=? AND user_id=?");
        $st->execute([$credId, $studioId, $userId]);
        return $st->rowCount() > 0;
    }

    /**
     * Authenticate a raw API key. Returns a joined credential+studio row with a
     * parsed ['scopes'] array, or null. Updates last_used_at on success.
     * Constant-time-ish: single indexed hash lookup, then status/expiry checks.
     */
    public static function authenticateApiKey(string $raw): ?array {
        $raw = trim($raw);
        if ($raw === '' || !str_starts_with($raw, 'ovhk_')) return null;
        $hash = self::hashSecret($raw);
        $st = db()->prepare("SELECT c.*, s.user_id AS studio_user, s.enabled AS studio_enabled,
                                    s.id AS sid
                             FROM camera_credentials c
                             JOIN camera_studios s ON s.id=c.studio_id
                             WHERE c.secret_hash=? AND c.kind='api_key' LIMIT 1");
        $st->execute([$hash]);
        $row = $st->fetch();
        if (!$row) return null;
        if ($row['status'] !== 'active') return null;
        if ($row['expires_at'] !== null && strtotime($row['expires_at']) < time()) return null;
        if ((int)$row['studio_enabled'] !== 1) return null;
        db()->prepare("UPDATE camera_credentials SET last_used_at=NOW() WHERE id=?")->execute([$row['id']]);
        $row['scope_list'] = $row['scopes'] === '' ? [] : preg_split('/\s+/', trim($row['scopes']));
        return $row;
    }

    public static function credHasScope(array $cred, string $scope): bool {
        $list = $cred['scope_list'] ?? [];
        return in_array($scope, $list, true);
    }

    /* ---------------- Devices ---------------- */

    public static function addDevice(int $studioId, int $userId, string $name, string $type = 'rtmp',
                                     ?string $model = null, string $protocol = 'rtmp'): int {
        $pdo = db();
        $studio = self::require($studioId, $userId);
        $count = (int)$pdo->query("SELECT COUNT(*) c FROM camera_devices WHERE studio_id=" . (int)$studioId)->fetch()['c'];
        if ($count >= (int)$studio['max_devices'])
            throw new RuntimeException('Device limit reached for this studio (' . (int)$studio['max_devices'] . ').');
        $path = 'cam_' . bin2hex(random_bytes(6));
        $ins = $pdo->prepare('INSERT INTO camera_devices
            (studio_id,user_id,name,device_type,model,ingest_protocol,stream_path) VALUES (?,?,?,?,?,?,?)');
        $ins->execute([$studioId, $userId, $name, $type, $model, $protocol, $path]);
        $did = (int)$pdo->lastInsertId();
        // Each device gets its own stream_key credential bound to it. The raw
        // value is discarded here; callers that need to show it once should use
        // createDeviceStreamKey() instead.
        self::createCredential($pdo, $studioId, $userId, 'stream_key', $name . ' stream key', [], $did);
        return $did;
    }

    /**
     * (Re)issue the publish stream key for a device: revoke any active stream
     * keys bound to the device, then mint a fresh one. Returns the raw secret
     * (shown once). Used by the dashboard "reveal / regenerate" flow and the API.
     */
    public static function createDeviceStreamKey(int $deviceId, int $userId): string {
        $pdo = db();
        $dev = self::deviceFind($deviceId, $userId);
        if (!$dev) throw new RuntimeException('Device not found.');
        $pdo->prepare("UPDATE camera_credentials SET status='revoked'
                       WHERE device_id=? AND kind='stream_key' AND status='active'")->execute([$deviceId]);
        $r = self::createCredential($pdo, (int)$dev['studio_id'], $userId, 'stream_key',
                $dev['name'] . ' stream key', [], $deviceId);
        return $r['raw'];
    }

    /**
     * Verify a publish attempt from the media server: match the raw publish key
     * to an active stream_key credential bound to the device that owns this
     * stream_path. Returns the device row on success, null on failure.
     */
    public static function verifyPublish(string $streamPath, string $rawKey): ?array {
        $pdo = db();
        $st = $pdo->prepare("SELECT * FROM camera_devices WHERE stream_path=? LIMIT 1");
        $st->execute([$streamPath]);
        $dev = $st->fetch();
        if (!$dev) return null;
        $hash = self::hashSecret(trim($rawKey));
        $c = $pdo->prepare("SELECT id FROM camera_credentials
                            WHERE device_id=? AND kind='stream_key' AND status='active' AND secret_hash=? LIMIT 1");
        $c->execute([(int)$dev['id'], $hash]);
        if (!$c->fetch()) return null;
        return $dev;
    }

    public static function devices(int $studioId, int $userId): array {
        $st = db()->prepare("SELECT * FROM camera_devices WHERE studio_id=? AND user_id=? ORDER BY id");
        $st->execute([$studioId, $userId]);
        return $st->fetchAll();
    }

    public static function deviceFind(int $deviceId, int $userId): ?array {
        $st = db()->prepare("SELECT * FROM camera_devices WHERE id=? AND user_id=? LIMIT 1");
        $st->execute([$deviceId, $userId]);
        return $st->fetch() ?: null;
    }

    public static function updateDevice(int $deviceId, int $userId, array $fields): bool {
        $allowed = ['name','device_type','model','ingest_protocol','status',
                    'processing_profile_id','audio_profile_id'];
        $set = []; $args = [];
        foreach ($fields as $k => $v) {
            if (!in_array($k, $allowed, true)) continue;
            $set[] = "$k=?"; $args[] = $v;
        }
        if (!$set) return false;
        $args[] = $deviceId; $args[] = $userId;
        $st = db()->prepare("UPDATE camera_devices SET " . implode(',', $set) . " WHERE id=? AND user_id=?");
        $st->execute($args);
        return $st->rowCount() >= 0;
    }

    public static function deleteDevice(int $deviceId, int $userId): bool {
        $st = db()->prepare("DELETE FROM camera_devices WHERE id=? AND user_id=?");
        $st->execute([$deviceId, $userId]);
        return $st->rowCount() > 0;
    }

    /* ---------------- Scenes ---------------- */

    public static function addScene(int $studioId, int $userId, string $name, string $layout = 'single'): int {
        $pdo = db();
        $studio = self::require($studioId, $userId);
        $count = (int)$pdo->query("SELECT COUNT(*) c FROM camera_scenes WHERE studio_id=" . (int)$studioId)->fetch()['c'];
        if ($count >= (int)$studio['max_scenes'])
            throw new RuntimeException('Scene limit reached for this studio (' . (int)$studio['max_scenes'] . ').');
        $sort = (int)$pdo->query("SELECT COALESCE(MAX(sort_order),-1)+1 s FROM camera_scenes WHERE studio_id=" . (int)$studioId)->fetch()['s'];
        $ins = $pdo->prepare('INSERT INTO camera_scenes (studio_id,user_id,name,layout,sort_order) VALUES (?,?,?,?,?)');
        $ins->execute([$studioId, $userId, $name, $layout, $sort]);
        return (int)$pdo->lastInsertId();
    }

    public static function scenes(int $studioId, int $userId): array {
        $st = db()->prepare("SELECT * FROM camera_scenes WHERE studio_id=? AND user_id=? ORDER BY sort_order,id");
        $st->execute([$studioId, $userId]);
        return $st->fetchAll();
    }

    public static function sceneFind(int $sceneId, int $userId): ?array {
        $st = db()->prepare("SELECT * FROM camera_scenes WHERE id=? AND user_id=? LIMIT 1");
        $st->execute([$sceneId, $userId]);
        return $st->fetch() ?: null;
    }

    /** Switch the active scene WITHOUT changing the OBS URL. Enforces ownership. */
    public static function setActiveScene(int $studioId, int $userId, int $sceneId): bool {
        $scene = self::sceneFind($sceneId, $userId);
        if (!$scene || (int)$scene['studio_id'] !== $studioId) return false;
        $st = db()->prepare("UPDATE camera_studios SET active_scene_id=? WHERE id=? AND user_id=?");
        $st->execute([$sceneId, $studioId, $userId]);
        return true;
    }

    public static function deleteScene(int $sceneId, int $userId): bool {
        $pdo = db();
        $scene = self::sceneFind($sceneId, $userId);
        if (!$scene) return false;
        $studioId = (int)$scene['studio_id'];
        $remaining = (int)$pdo->query("SELECT COUNT(*) c FROM camera_scenes WHERE studio_id=" . $studioId)->fetch()['c'];
        if ($remaining <= 1) throw new RuntimeException('A studio must keep at least one scene.');
        $pdo->prepare("DELETE FROM camera_scenes WHERE id=? AND user_id=?")->execute([$sceneId, $userId]);
        // If we deleted the active scene, promote the first remaining one.
        $studio = self::find($studioId, $userId);
        if ($studio && (int)$studio['active_scene_id'] === $sceneId) {
            $next = $pdo->query("SELECT id FROM camera_scenes WHERE studio_id=" . $studioId . " ORDER BY sort_order,id LIMIT 1")->fetch();
            if ($next) $pdo->prepare("UPDATE camera_studios SET active_scene_id=? WHERE id=?")->execute([(int)$next['id'], $studioId]);
        }
        return true;
    }

    /* ---------------- Scene elements ---------------- */

    public static function addElement(int $sceneId, int $userId, array $el): int {
        $scene = self::sceneFind($sceneId, $userId);
        if (!$scene) throw new RuntimeException('Scene not found.');
        $ins = db()->prepare('INSERT INTO camera_scene_elements
            (scene_id,studio_id,element_type,device_id,label,x,y,w,h,z_index,props)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $ins->execute([
            $sceneId, (int)$scene['studio_id'],
            $el['element_type'] ?? 'camera',
            $el['device_id'] ?? null,
            $el['label'] ?? null,
            $el['x'] ?? 0, $el['y'] ?? 0, $el['w'] ?? 100, $el['h'] ?? 100,
            $el['z_index'] ?? 0,
            isset($el['props']) ? (is_string($el['props']) ? $el['props'] : json_encode($el['props'])) : null,
        ]);
        return (int)db()->lastInsertId();
    }

    public static function elements(int $sceneId, int $userId): array {
        $scene = self::sceneFind($sceneId, $userId);
        if (!$scene) return [];
        $st = db()->prepare("SELECT * FROM camera_scene_elements WHERE scene_id=? ORDER BY z_index,id");
        $st->execute([$sceneId]);
        return $st->fetchAll();
    }

    public static function deleteElement(int $elementId, int $userId): bool {
        // Join back to scene to enforce ownership.
        $st = db()->prepare("DELETE e FROM camera_scene_elements e
                             JOIN camera_scenes s ON s.id=e.scene_id
                             WHERE e.id=? AND s.user_id=?");
        $st->execute([$elementId, $userId]);
        return $st->rowCount() > 0;
    }

    /* ---------------- Privacy zones ---------------- */

    public static function addPrivacyZone(int $deviceId, int $userId, array $z): int {
        $dev = self::deviceFind($deviceId, $userId);
        if (!$dev) throw new RuntimeException('Device not found.');
        $ins = db()->prepare('INSERT INTO camera_privacy_zones
            (studio_id,device_id,name,shape,x,y,w,h,blur_strength,enabled) VALUES (?,?,?,?,?,?,?,?,?,?)');
        $ins->execute([
            (int)$dev['studio_id'], $deviceId,
            $z['name'] ?? 'Zone', $z['shape'] ?? 'rect',
            $z['x'] ?? 0, $z['y'] ?? 0, $z['w'] ?? 20, $z['h'] ?? 20,
            $z['blur_strength'] ?? 20, isset($z['enabled']) ? (int)(bool)$z['enabled'] : 1,
        ]);
        return (int)db()->lastInsertId();
    }

    public static function privacyZones(int $deviceId, int $userId): array {
        $dev = self::deviceFind($deviceId, $userId);
        if (!$dev) return [];
        $st = db()->prepare("SELECT * FROM camera_privacy_zones WHERE device_id=? ORDER BY id");
        $st->execute([$deviceId]);
        return $st->fetchAll();
    }

    public static function deletePrivacyZone(int $zoneId, int $userId): bool {
        $st = db()->prepare("DELETE z FROM camera_privacy_zones z
                             JOIN camera_devices d ON d.id=z.device_id
                             WHERE z.id=? AND d.user_id=?");
        $st->execute([$zoneId, $userId]);
        return $st->rowCount() > 0;
    }

    /* ---------------- Profiles ---------------- */

    public static function processingProfiles(int $studioId, int $userId): array {
        self::require($studioId, $userId);
        $st = db()->prepare("SELECT * FROM camera_processing_profiles WHERE studio_id=? ORDER BY id");
        $st->execute([$studioId]);
        return $st->fetchAll();
    }

    public static function audioProfiles(int $studioId, int $userId): array {
        self::require($studioId, $userId);
        $st = db()->prepare("SELECT * FROM camera_audio_profiles WHERE studio_id=? ORDER BY id");
        $st->execute([$studioId]);
        return $st->fetchAll();
    }

    public static function updateProcessingProfile(int $profileId, int $userId, array $fields): bool {
        $allowed = ['name','resolution','fps','bitrate_kbps','codec',
                    'face_blur_enabled','face_blur_strength','denoise'];
        return self::updateScoped('camera_processing_profiles', $profileId, $userId, $fields, $allowed);
    }

    public static function updateAudioProfile(int $profileId, int $userId, array $fields): bool {
        $allowed = ['name','source','gain_db','noise_suppression','echo_cancel','muted'];
        return self::updateScoped('camera_audio_profiles', $profileId, $userId, $fields, $allowed);
    }

    /** Update a studio-owned row, verifying ownership through the studio join. */
    private static function updateScoped(string $table, int $id, int $userId, array $fields, array $allowed): bool {
        $set = []; $args = [];
        foreach ($fields as $k => $v) {
            if (!in_array($k, $allowed, true)) continue;
            $set[] = "t.$k=?"; $args[] = $v;
        }
        if (!$set) return false;
        $args[] = $id; $args[] = $userId;
        $sql = "UPDATE $table t JOIN camera_studios s ON s.id=t.studio_id
                SET " . implode(',', $set) . " WHERE t.id=? AND s.user_id=?";
        $st = db()->prepare($sql); $st->execute($args);
        return $st->rowCount() >= 0;
    }

    /* ---------------- Streams ---------------- */

    /** Begin a stream session for a device (app state only). */
    public static function startStream(int $deviceId, int $userId): int {
        $pdo = db();
        $dev = self::deviceFind($deviceId, $userId);
        if (!$dev) throw new RuntimeException('Device not found.');
        // One active session per device.
        $pdo->prepare("UPDATE camera_streams SET status='ended', ended_at=NOW()
                       WHERE device_id=? AND status IN ('starting','live')")->execute([$deviceId]);
        $ins = $pdo->prepare("INSERT INTO camera_streams (studio_id,device_id,user_id,status,started_at)
                              VALUES (?,?,?, 'starting', NOW())");
        $ins->execute([(int)$dev['studio_id'], $deviceId, $userId]);
        $streamId = (int)$pdo->lastInsertId();
        $pdo->prepare("UPDATE camera_devices SET status='streaming', last_seen_at=NOW() WHERE id=?")->execute([$deviceId]);
        return $streamId;
    }

    public static function stopStream(int $streamId, int $userId): bool {
        $pdo = db();
        $st = $pdo->prepare("SELECT * FROM camera_streams WHERE id=? AND user_id=? LIMIT 1");
        $st->execute([$streamId, $userId]);
        $stream = $st->fetch();
        if (!$stream) return false;
        $pdo->prepare("UPDATE camera_streams SET status='ended', ended_at=NOW() WHERE id=?")->execute([$streamId]);
        $pdo->prepare("UPDATE camera_devices SET status='online' WHERE id=?")->execute([(int)$stream['device_id']]);
        return true;
    }

    public static function streams(int $studioId, int $userId, int $limit = 50): array {
        self::require($studioId, $userId);
        $limit = max(1, min(500, $limit));
        $st = db()->prepare("SELECT cs.*, d.name AS device_name FROM camera_streams cs
                             JOIN camera_devices d ON d.id=cs.device_id
                             WHERE cs.studio_id=? ORDER BY cs.id DESC LIMIT $limit");
        $st->execute([$studioId]);
        return $st->fetchAll();
    }

    public static function streamFind(int $streamId, int $userId): ?array {
        $st = db()->prepare("SELECT * FROM camera_streams WHERE id=? AND user_id=? LIMIT 1");
        $st->execute([$streamId, $userId]);
        return $st->fetch() ?: null;
    }

    /* ---------------- Recordings & snapshots ---------------- */

    public static function startRecording(int $studioId, int $userId, ?int $streamId, ?int $deviceId): int {
        $studio = self::require($studioId, $userId);
        if ((int)$studio['recording_enabled'] !== 1)
            throw new RuntimeException('Recording is disabled for this studio.');
        $fn = 'rec_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.mp4';
        $ins = db()->prepare("INSERT INTO camera_recordings
            (studio_id,stream_id,device_id,filename,status,started_at) VALUES (?,?,?,?, 'recording', NOW())");
        $ins->execute([$studioId, $streamId, $deviceId, $fn]);
        return (int)db()->lastInsertId();
    }

    public static function stopRecording(int $recId, int $userId, array $meta = []): bool {
        $st = db()->prepare("UPDATE camera_recordings r JOIN camera_studios s ON s.id=r.studio_id
            SET r.status='ready', r.ended_at=NOW(),
                r.duration_s=COALESCE(?, r.duration_s),
                r.size_bytes=COALESCE(?, r.size_bytes),
                r.url=COALESCE(?, r.url)
            WHERE r.id=? AND s.user_id=?");
        $st->execute([$meta['duration_s'] ?? null, $meta['size_bytes'] ?? null, $meta['url'] ?? null, $recId, $userId]);
        return $st->rowCount() >= 0;
    }

    public static function recordings(int $studioId, int $userId, int $limit = 50): array {
        self::require($studioId, $userId);
        $limit = max(1, min(500, $limit));
        $st = db()->prepare("SELECT * FROM camera_recordings WHERE studio_id=? ORDER BY id DESC LIMIT $limit");
        $st->execute([$studioId]);
        return $st->fetchAll();
    }

    public static function addSnapshot(int $studioId, int $userId, ?int $deviceId, ?int $streamId,
                                       ?string $url = null): int {
        self::require($studioId, $userId);
        $fn = 'snap_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $ins = db()->prepare("INSERT INTO camera_snapshots (studio_id,device_id,stream_id,filename,url)
                              VALUES (?,?,?,?,?)");
        $ins->execute([$studioId, $deviceId, $streamId, $fn, $url]);
        return (int)db()->lastInsertId();
    }

    public static function snapshots(int $studioId, int $userId, int $limit = 50): array {
        self::require($studioId, $userId);
        $limit = max(1, min(500, $limit));
        $st = db()->prepare("SELECT * FROM camera_snapshots WHERE studio_id=? ORDER BY id DESC LIMIT $limit");
        $st->execute([$studioId]);
        return $st->fetchAll();
    }

    /* ---------------- Analytics ---------------- */

    public static function recordMetric(int $studioId, ?int $streamId, string $metric, float $value, ?string $meta = null): void {
        $ins = db()->prepare("INSERT INTO camera_analytics (studio_id,stream_id,metric,value,meta) VALUES (?,?,?,?,?)");
        $ins->execute([$studioId, $streamId, $metric, $value, $meta]);
    }

    public static function analyticsSummary(int $studioId, int $userId): array {
        self::require($studioId, $userId);
        $pdo = db();
        $streams = (int)$pdo->query("SELECT COUNT(*) c FROM camera_streams WHERE studio_id=$studioId")->fetch()['c'];
        $live    = (int)$pdo->query("SELECT COUNT(*) c FROM camera_streams WHERE studio_id=$studioId AND status='live'")->fetch()['c'];
        $devices = (int)$pdo->query("SELECT COUNT(*) c FROM camera_devices WHERE studio_id=$studioId")->fetch()['c'];
        $recs    = (int)$pdo->query("SELECT COUNT(*) c FROM camera_recordings WHERE studio_id=$studioId")->fetch()['c'];
        $peak    = (int)$pdo->query("SELECT COALESCE(MAX(viewer_peak),0) p FROM camera_streams WHERE studio_id=$studioId")->fetch()['p'];
        return ['streams'=>$streams,'live'=>$live,'devices'=>$devices,'recordings'=>$recs,'viewer_peak'=>$peak];
    }

    /* ---------------- OBS output composition ---------------- */

    /**
     * Build the public scene payload for the OBS output / viewer page. Reads by
     * obs_token (no user session). Returns the active scene, its elements and
     * the minimal device info the renderer needs (never secrets).
     */
    public static function obsScenePayload(array $studio): array {
        $pdo = db();
        $sid = (int)$studio['id'];
        $activeId = (int)($studio['active_scene_id'] ?? 0);
        $scene = null;
        if ($activeId) {
            $st = $pdo->prepare("SELECT * FROM camera_scenes WHERE id=? AND studio_id=? LIMIT 1");
            $st->execute([$activeId, $sid]);
            $scene = $st->fetch() ?: null;
        }
        if (!$scene) {
            $scene = $pdo->query("SELECT * FROM camera_scenes WHERE studio_id=$sid ORDER BY sort_order,id LIMIT 1")->fetch() ?: null;
        }
        $elements = [];
        if ($scene) {
            $st = $pdo->prepare("SELECT id,element_type,device_id,label,x,y,w,h,z_index,props
                                 FROM camera_scene_elements WHERE scene_id=? ORDER BY z_index,id");
            $st->execute([(int)$scene['id']]);
            $elements = $st->fetchAll();
        }
        // Devices referenced -> expose only their public streaming state + path.
        $devs = $pdo->query("SELECT id,name,status,stream_path FROM camera_devices WHERE studio_id=$sid")->fetchAll();
        $devMap = [];
        foreach ($devs as $d) $devMap[(int)$d['id']] = $d;
        return [
            'studio'   => ['id'=>$sid, 'name'=>$studio['name']],
            'scene'    => $scene ? ['id'=>(int)$scene['id'],'name'=>$scene['name'],'layout'=>$scene['layout'],'transition'=>$scene['transition']] : null,
            'elements' => $elements,
            'devices'  => $devMap,
        ];
    }
}
