<?php
declare(strict_types=1);
require_once __DIR__ . '/db.php';

// mbstring fallbacks (portability on hosts without ext-mbstring)
if (!function_exists('mb_substr')) { function mb_substr($s,$start,$len=null,$enc=null){ return $len===null?substr((string)$s,$start):substr((string)$s,$start,$len); } }
if (!function_exists('mb_strimwidth')) { function mb_strimwidth($s,$start,$width,$trim='',$enc=null){ $s=(string)$s; $r=substr($s,$start,$width); return strlen($s)>$start+$width?$r.$trim:$r; } }

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
    session_start();
}

/* ---------------- URL / base path ---------------- */
function base_url(): string {
    if (SITE_URL !== '') return rtrim(SITE_URL, '/');
    $https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') === '443';
    $scheme = $https ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir    = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    // if running from /admin, step up one level for the site root
    if (substr($dir, -6) === '/admin') $dir = substr($dir, 0, -6);
    return $scheme . '://' . $host . $dir;
}
function url(string $path = ''): string { return base_url() . '/' . ltrim($path, '/'); }

/* ---------------- Escaping ---------------- */
function e(?string $v): string { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }

/* ---------------- CSRF ---------------- */
function csrf_token(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}
function csrf_field(): string { return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">'; }
function csrf_check(): void {
    $t = $_POST['_csrf'] ?? '';
    if (!is_string($t) || !hash_equals($_SESSION['csrf'] ?? '', $t)) {
        http_response_code(419);
        exit('Session expired. Please go back and try again.');
    }
}

/* ---------------- Auth ---------------- */
function current_user(): ?array {
    if (empty($_SESSION['uid'])) return null;
    static $u = null;
    if ($u !== null) return $u;
    $st = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $st->execute([$_SESSION['uid']]);
    $u = $st->fetch() ?: null;
    if ($u && $u['status'] === 'blocked') { logout(); return null; }
    return $u;
}
function login_user(array $u): void { session_regenerate_id(true); $_SESSION['uid'] = (int)$u['id']; }
function logout(): void { $_SESSION = []; session_destroy(); }
function require_login(): array {
    $u = current_user();
    if (!$u) { header('Location: ' . url('login.php')); exit; }
    return $u;
}
function require_admin(): array {
    $u = current_user();
    if (!$u || $u['role'] !== 'admin') { header('Location: ' . url('admin/login.php')); exit; }
    return $u;
}

/* ---------------- Misc ---------------- */
function flash(string $msg = null): ?string {
    if ($msg !== null) { $_SESSION['flash'] = $msg; return null; }
    $m = $_SESSION['flash'] ?? null; unset($_SESSION['flash']); return $m;
}
function redirect(string $path): never { header('Location: ' . (str_starts_with($path,'http')?$path:url($path))); exit; }

function gen_key(): string {
    // Readable API key like: OVH-XXXX-XXXX-XXXX-XXXX
    $a = strtoupper(bin2hex(random_bytes(8)));
    return 'OVH-' . substr($a,0,4).'-'.substr($a,4,4).'-'.substr($a,8,4).'-'.substr($a,12,4);
}
function gen_token(): string { return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); }

function audit(string $action, string $detail = ''): void {
    try {
        $st = db()->prepare('INSERT INTO audit_logs (actor, action, detail, ip) VALUES (?,?,?,?)');
        $u = current_user();
        $st->execute([$u['email'] ?? 'guest', $action, $detail, $_SERVER['REMOTE_ADDR'] ?? '']);
    } catch (Throwable) {}
}

/** Build a settings tree of {group:{key:default}} from any schema array. */
function schema_defaults(array $schema): array {
    $out = [];
    foreach ($schema as $group => $fields) {
        if (!is_array($fields)) continue;
        $out[$group] = [];
        foreach ($fields as $k => $f) $out[$group][$k] = is_array($f) ? ($f['default'] ?? null) : null;
    }
    return $out;
}

/** Defaults for the built-in chat overlay (assets/settings.schema.json). */
function default_settings(): array {
    $schema = json_decode(file_get_contents(__DIR__ . '/../assets/settings.schema.json'), true) ?: [];
    return schema_defaults($schema);
}

/** Merge a saved settings tree over a schema's defaults, keeping only schema keys. */
function merge_settings(array $schema, ?array $saved): array {
    $out = [];
    foreach ($schema as $group => $fields) {
        if (!is_array($fields)) continue;
        $out[$group] = [];
        foreach ($fields as $k => $f) {
            $out[$group][$k] = $saved[$group][$k] ?? (is_array($f) ? ($f['default'] ?? null) : null);
        }
    }
    return $out;
}

/**
 * Pull the JSON customisation schema embedded in a custom overlay's HTML:
 *   <script type="application/json" id="overlay-schema">{ ... }</script>
 * Returns the decoded array, or null when it is missing / not valid JSON.
 */
function extract_overlay_schema(string $html): ?array {
    // Strip HTML comments first so a mention of the tag in a comment can't be matched.
    $clean = preg_replace('/<!--.*?-->/s', '', $html);
    if ($clean === null) $clean = $html;
    if (!preg_match('~<script[^>]*\bid\s*=\s*["\']overlay-schema["\'][^>]*>(.*?)</script>~is', $clean, $m)) return null;
    $decoded = json_decode(trim($m[1]), true);
    return is_array($decoded) ? $decoded : null;
}

/** True when the HTML contains an overlay-schema script block (valid or not). */
function has_overlay_schema_block(string $html): bool {
    $clean = preg_replace('/<!--.*?-->/s', '', $html);
    if ($clean === null) $clean = $html;
    return (bool)preg_match('~<script[^>]*\bid\s*=\s*["\']overlay-schema["\'][^>]*>.*?</script>~is', $clean);
}

/**
 * Structurally validate an overlay customisation schema.
 * Returns null when valid, or a human-readable error string describing the first problem.
 * An empty schema ([]) is valid and means "no customisable settings".
 */
function validate_overlay_schema(array $schema): ?string {
    $allowed = ['text','number','boolean','enum','color'];
    foreach ($schema as $group => $fields) {
        if (!is_string($group) || $group === '')      return 'Schema group names must be non-empty strings.';
        if (!is_array($fields) || array_is_list($fields))
                                                       return "Schema group \"$group\" must be an object of fields.";
        foreach ($fields as $key => $f) {
            $where = "\"$group.$key\"";
            if (!is_string($key) || $key === '')       return "Field names in \"$group\" must be non-empty strings.";
            if (!is_array($f) || array_is_list($f))    return "Field $where must be an object.";
            $type = $f['type'] ?? null;
            if (!is_string($type) || !in_array($type, $allowed, true))
                                                       return "Field $where has an unsupported type (allowed: " . implode(', ', $allowed) . ').';
            if (!array_key_exists('default', $f))      return "Field $where is missing a \"default\".";
            $d = $f['default'];
            if ($type === 'enum') {
                if (!isset($f['options']) || !is_array($f['options']) || !array_is_list($f['options']) || count($f['options']) === 0)
                                                       return "Enum field $where needs a non-empty \"options\" array.";
                foreach ($f['options'] as $opt) if (!is_string($opt) && !is_numeric($opt))
                                                       return "Enum field $where options must be strings or numbers.";
                if (!in_array($d, $f['options'], true))return "Enum field $where default must be one of its options.";
            } elseif ($type === 'number') {
                if (!is_int($d) && !is_float($d))      return "Number field $where default must be numeric.";
                foreach (['min','max','step'] as $b) if (isset($f[$b]) && !is_int($f[$b]) && !is_float($f[$b]))
                                                       return "Number field $where \"$b\" must be numeric.";
                if (isset($f['min'], $f['max']) && $f['min'] > $f['max'])
                                                       return "Number field $where has min greater than max.";
            } elseif ($type === 'boolean') {
                if (!is_bool($d))                      return "Boolean field $where default must be true or false.";
            } elseif ($type === 'color') {
                if (!is_string($d) || !preg_match('/^#[0-9a-fA-F]{6}$/', $d))
                                                       return "Color field $where default must be a #rrggbb value.";
            } else { // text
                if (!is_string($d) && !is_numeric($d)) return "Text field $where default must be a string.";
                if (isset($f['maxLength']) && !is_int($f['maxLength']))
                                                       return "Text field $where \"maxLength\" must be an integer.";
            }
        }
    }
    return null;
}

/**
 * The single validated pipeline for both uploaded and pasted custom-overlay HTML.
 * Returns:
 *   ['ok'=>true, 'html'=>string, 'schema'=>array, 'schemaJson'=>string, 'hasSchema'=>bool]
 *   ['ok'=>false,'error'=>string]
 * A document without an overlay-schema block is accepted as a static overlay
 * (hasSchema=false, schema=[]). A malformed schema block is rejected.
 */
function process_custom_overlay_html(string $html, int $maxBytes = 3145728): array {
    // Strip a UTF-8 BOM if present.
    if (str_starts_with($html, "\xEF\xBB\xBF")) $html = substr($html, 3);
    $len = strlen($html);
    if ($len === 0)             return ['ok' => false, 'error' => 'The HTML is empty.'];
    if ($len > $maxBytes)       return ['ok' => false, 'error' => 'The HTML is too large (max ' . round($maxBytes / 1048576, 1) . ' MB).'];
    if (!preg_match('/<[a-z!\/]/i', $html))
                                return ['ok' => false, 'error' => 'This does not look like an HTML document (no tags found).'];

    $hasBlock = has_overlay_schema_block($html);
    if ($hasBlock) {
        $schema = extract_overlay_schema($html);
        if ($schema === null)   return ['ok' => false, 'error' => 'The overlay-schema block is present but is not valid JSON.'];
        if ($err = validate_overlay_schema($schema))
                                return ['ok' => false, 'error' => $err];
    } else {
        $schema = []; // static overlay, no customisable settings
    }
    return [
        'ok'         => true,
        'html'       => $html,
        'schema'     => $schema,
        'schemaJson' => json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'hasSchema'  => $hasBlock,
    ];
}
