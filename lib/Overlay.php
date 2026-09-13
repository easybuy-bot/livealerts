<?php
declare(strict_types=1);
require_once __DIR__ . '/../inc/helpers.php';

final class Overlay
{
    /** Columns from the shared chat source, overriding legacy per-overlay columns. */
    private const SOURCE_SELECT = "
        COALESCE(cs.source_type,o.source_type) AS source_type,
        COALESCE(cs.yt_api_key,o.yt_api_key)   AS yt_api_key,
        COALESCE(cs.yt_video_id,o.yt_video_id) AS yt_video_id,
        COALESCE(cs.live_chat_id,o.live_chat_id) AS live_chat_id,
        COALESCE(cs.next_page_token,o.next_page_token) AS next_page_token,
        COALESCE(cs.last_poll_at,o.last_poll_at) AS last_poll_at,
        cs.last_message_at, cs.last_state, cs.last_reason,
        cs.yt_mode, cs.yt_channel_url, cs.yt_channel_id, cs.yt_channel_title,
        cs.yt_uploads_playlist, cs.live_video_title, cs.live_status, cs.last_checked_at";

    /** Resolve a valid, active overlay by its browser-source token, or null. */
    public static function byToken(string $token): ?array {
        $sql = "SELECT o.*, k.status AS key_status, k.expires_at, k.key_code,
                       u.status AS user_status, p.title AS product_title,
                       p.kind AS product_kind, p.overlay_html AS product_html,
                       p.overlay_schema AS product_schema," . self::SOURCE_SELECT . "
                FROM overlays o
                JOIN access_keys k ON k.id = o.access_key_id
                JOIN users u ON u.id = o.user_id
                JOIN products p ON p.id = o.product_id
                LEFT JOIN chat_sources cs ON cs.id = o.source_id
                WHERE o.token = ? LIMIT 1";
        $st = db()->prepare($sql);
        $st->execute([$token]);
        $o = $st->fetch();
        if (!$o) return null;
        if ($o['user_status'] === 'blocked') return null;
        if ($o['key_status'] !== 'active') return null;
        if ($o['expires_at'] !== null && strtotime($o['expires_at']) < time()) {
            db()->prepare("UPDATE access_keys SET status='expired' WHERE id=?")->execute([$o['access_key_id']]);
            return null;
        }
        return $o;
    }

    /** Ensure a single shared chat source exists for an access key; return its id. */
    public static function ensureSource(PDO $pdo, int $accessKeyId): int {
        $st = $pdo->prepare('SELECT id FROM chat_sources WHERE access_key_id=? LIMIT 1');
        $st->execute([$accessKeyId]);
        if ($row = $st->fetch()) return (int)$row['id'];
        $pdo->prepare('INSERT INTO chat_sources (access_key_id, source_type) VALUES (?, ?)')
            ->execute([$accessKeyId, 'demo']);
        return (int)$pdo->lastInsertId();
    }

    /** Build a settings JSON string for a new instance in the given layout mode. */
    public static function settingsForMode(string $mode): string {
        $s = default_settings();
        if (isset($s['layout']) && is_array($s['layout'])) $s['layout']['mode'] = $mode === 'horizontal' ? 'horizontal' : 'vertical';
        if ($mode === 'horizontal' && isset($s['general'])) { $s['general']['width'] = 1280; $s['general']['height'] = 320; }
        return json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Create one overlay instance for a key. Returns the new overlay id. */
    public static function createInstance(PDO $pdo, int $accessKeyId, int $userId, int $productId,
                                          int $sourceId, string $name, string $mode = 'vertical'): int {
        $ins = $pdo->prepare('INSERT INTO overlays (access_key_id,user_id,product_id,name,enabled,source_id,token,source_type,settings)
                              VALUES (?,?,?,?,1,?,?,?,?)');
        $ins->execute([$accessKeyId, $userId, $productId, mb_substr($name, 0, 120), $sourceId,
                       gen_token(), 'demo', self::settingsForMode($mode)]);
        return (int)$pdo->lastInsertId();
    }

    /** Redeem an access key for a user: bind it and create the first overlay instance. */
    public static function redeem(string $keyCode, int $userId): array {
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('SELECT * FROM access_keys WHERE key_code = ? LIMIT 1 FOR UPDATE');
            $st->execute([$keyCode]);
            $key = $st->fetch();
            if (!$key)                     throw new RuntimeException('This API key was not found. Check for typos.');
            if ($key['status'] !== 'active') throw new RuntimeException('This API key is ' . $key['status'] . '.');
            if ($key['expires_at'] !== null && strtotime($key['expires_at']) < time())
                                            throw new RuntimeException('This API key has expired.');
            if ($key['user_id'] !== null && (int)$key['user_id'] !== $userId)
                                            throw new RuntimeException('This API key is already assigned to another account.');

            // Return the existing primary overlay if this key was already activated.
            $ex = $pdo->prepare('SELECT id FROM overlays WHERE access_key_id = ? ORDER BY id ASC LIMIT 1');
            $ex->execute([$key['id']]);
            if ($row = $ex->fetch()) { $pdo->commit(); return ['overlay_id' => (int)$row['id'], 'new' => false]; }

            $pdo->prepare('UPDATE access_keys SET user_id=?, activated_at=NOW() WHERE id=?')
                ->execute([$userId, $key['id']]);

            $sourceId = self::ensureSource($pdo, (int)$key['id']);
            $ptitle = $pdo->query('SELECT title FROM products WHERE id=' . (int)$key['product_id'])->fetch()['title'] ?? 'Overlay';
            $id = self::createInstance($pdo, (int)$key['id'], $userId, (int)$key['product_id'],
                                       $sourceId, $ptitle . ' — Vertical', 'vertical');
            $pdo->commit();
            return ['overlay_id' => $id, 'new' => true];
        } catch (Throwable $ex) {
            $pdo->rollBack();
            throw $ex;
        }
    }

    /** All overlays owned by a user (one row per instance). */
    public static function forUser(int $userId): array {
        $sql = "SELECT o.*, p.title AS product_title, p.category, p.kind AS product_kind,
                       k.key_code, k.status AS key_status, k.expires_at
                FROM overlays o
                JOIN products p ON p.id = o.product_id
                JOIN access_keys k ON k.id = o.access_key_id
                WHERE o.user_id = ? ORDER BY o.access_key_id, o.id";
        $st = db()->prepare($sql);
        $st->execute([$userId]);
        return $st->fetchAll();
    }

    /** All overlay instances that belong to the same access key (for the manager). */
    public static function instancesForKey(int $accessKeyId, int $userId): array {
        $st = db()->prepare("SELECT o.*, p.kind AS product_kind FROM overlays o
                             JOIN products p ON p.id=o.product_id
                             WHERE o.access_key_id=? AND o.user_id=? ORDER BY o.id");
        $st->execute([$accessKeyId, $userId]);
        return $st->fetchAll();
    }

    public static function find(int $id, int $userId): ?array {
        $st = db()->prepare("SELECT o.*, p.title AS product_title, p.kind AS product_kind,
                                    p.overlay_schema AS product_schema,
                                    k.key_code, k.status AS key_status, k.expires_at," . self::SOURCE_SELECT . "
                             FROM overlays o JOIN products p ON p.id=o.product_id
                             JOIN access_keys k ON k.id=o.access_key_id
                             LEFT JOIN chat_sources cs ON cs.id=o.source_id
                             WHERE o.id=? AND o.user_id=? LIMIT 1");
        $st->execute([$id, $userId]);
        return $st->fetch() ?: null;
    }

    public static function obsUrl(array $overlay): string { return url('view.php?t=' . $overlay['token']); }

    /** Layout mode ('vertical'|'horizontal') read from an overlay's saved settings. */
    public static function modeOf(array $o): string {
        $s = !empty($o['settings']) ? json_decode((string)$o['settings'], true) : null;
        return (is_array($s) && ($s['layout']['mode'] ?? '') === 'horizontal') ? 'horizontal' : 'vertical';
    }

    /** Is this overlay row a custom (admin-uploaded HTML) overlay? */
    public static function isCustom(array $o): bool {
        return ($o['product_kind'] ?? 'chat') === 'custom';
    }

    /**
     * Emit a full HTML document for a custom-kind overlay: the admin-uploaded
     * HTML with a small settings adapter injected. The same output powers both
     * the live OBS browser source (view.php) and the dashboard editor preview.
     */
    public static function renderCustomPage(array $o): void {
        $schema   = json_decode((string)($o['product_schema'] ?? ''), true) ?: [];
        $saved    = !empty($o['settings']) ? json_decode((string)$o['settings'], true) : null;
        $settings = merge_settings($schema, is_array($saved) ? $saved : null);
        // Script-safe JSON: <, >, &, ', " are escaped so values can never break out
        // of the <script> tag, while Unicode (e.g. Hindi) stays human-readable.
        $json = json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP);

        $head = '<script>window.OVERLAY_SETTINGS=' . $json . ';'
              . '(function(){try{var s=window.OVERLAY_SETTINGS||{},r=document.documentElement;'
              . 'for(var g in s){if(!Object.prototype.hasOwnProperty.call(s,g))continue;var o=s[g];'
              . 'if(o&&typeof o===\'object\'){for(var k in o){if(!Object.prototype.hasOwnProperty.call(o,k))continue;'
              . 'r.style.setProperty(\'--ov-\'+g+\'-\'+k,String(o[k]));}}}}catch(e){}})();</script>';

        $adapter = <<<'HTML'
<script>
(function(){
  var origin = location.origin;
  function vars(s){ try{ var r=document.documentElement;
    for(var g in s){ if(!Object.prototype.hasOwnProperty.call(s,g))continue; var o=s[g];
      if(o&&typeof o==='object'){ for(var k in o){ if(!Object.prototype.hasOwnProperty.call(o,k))continue;
        r.style.setProperty('--ov-'+g+'-'+k, String(o[k])); } } } }catch(e){} }
  function apply(s){ if(!s||typeof s!=='object')return; window.OVERLAY_SETTINGS=s; vars(s);
    try{ if(typeof window.applySettings==='function') window.applySettings(s); }catch(e){} }
  apply(window.OVERLAY_SETTINGS);
  window.addEventListener('message', function(e){ if(e.origin!==origin)return; var d=e.data||{};
    if(d.type==='settings') apply(d.settings);
    else if(d.type==='sample'){ try{ if(typeof window.onSample==='function') window.onSample(d.kind); }catch(err){} }
    else if(d.type==='preview-init'){ try{ e.source&&e.source.postMessage({type:'preview-ready'},origin); }catch(err){} }
  });
  if(window.parent && window.parent!==window){ try{ window.parent.postMessage({type:'preview-ready'},origin); }catch(e){} }
})();
</script>
HTML;

        $html = (string)$o['product_html'];
        // Insert the initial-settings block right after the opening <head> tag.
        if (preg_match('~<head\b[^>]*>~i', $html, $m, PREG_OFFSET_CAPTURE)) {
            $at = $m[0][1] + strlen($m[0][0]);
            $html = substr_replace($html, "\n" . $head, $at, 0);      // substr_replace: no $/\ interpolation
        } else {
            $html = $head . $html;
        }
        // Insert the adapter just before </body> (fallback: append).
        $b = stripos($html, '</body>');
        if ($b !== false) $html = substr_replace($html, $adapter . "\n", $b, 0);
        else              $html .= $adapter;

        echo $html;
    }
}
