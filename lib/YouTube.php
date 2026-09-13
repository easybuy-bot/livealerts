<?php
declare(strict_types=1);

/**
 * Minimal YouTube live-chat reader using YouTube Data API v3 + a public API key.
 * No OAuth needed for public live streams.
 *   1. videos.list(part=liveStreamingDetails) -> activeLiveChatId
 *   2. liveChat/messages -> poll messages + nextPageToken
 */
final class YouTube
{
    /**
     * @param string        $apiKey    YouTube Data API key.
     * @param callable|null  $transport Optional HTTP seam for tests:
     *   fn(string $path, array $query): array  (return decoded JSON, or throw a
     *   RuntimeException('yt:reason') to simulate an API error). Never used in
     *   production — real calls go through curl below.
     */
    public function __construct(private string $apiKey, private $transport = null) {}

    private function get(string $path, array $q): array {
        if ($this->transport !== null) {
            $r = ($this->transport)($path, $q);
            if ($r instanceof \Throwable) throw $r;
            if (!is_array($r)) throw new RuntimeException('bad response');
            return $r;
        }
        $q['key'] = $this->apiKey;
        $url = 'https://www.googleapis.com/youtube/v3/' . $path . '?' . http_build_query($q);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 12,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($body === false) throw new RuntimeException('network: ' . $err);
        $json = json_decode((string)$body, true);
        if (!is_array($json)) throw new RuntimeException('bad response');
        if ($code >= 400) {
            $reason = $json['error']['errors'][0]['reason'] ?? ('http_' . $code);
            throw new RuntimeException('yt:' . $reason);
        }
        return $json;
    }

    /** Resolve the active live chat id for a video id. */
    public function liveChatId(string $videoId): ?string {
        $r = $this->get('videos', ['part' => 'liveStreamingDetails', 'id' => $videoId]);
        return $r['items'][0]['liveStreamingDetails']['activeLiveChatId'] ?? null;
    }

    /* ====================================================================
     * Automatic channel mode (v4.3)
     *   CHANNEL  = persistent connection
     *   VIDEO    = temporary current livestream
     *   CHAT ID  = temporary current livestream chat
     * ==================================================================== */

    /**
     * Parse a user-supplied channel string into an official API lookup.
     * Pure (no network) so it is unit-testable. Returns [type,value] where type
     * is 'id' | 'handle' | 'username', or null when nothing usable is found.
     * Never scrapes HTML and never accepts arbitrary URLs.
     */
    public static function parseChannelInput(string $input): ?array {
        $s = trim($input);
        if ($s === '') return null;
        // Direct channel id (UC + 22 chars), possibly inside a /channel/ URL.
        if (preg_match('~(UC[A-Za-z0-9_-]{22})~', $s, $m)) return ['type' => 'id', 'value' => $m[1]];
        // @handle inside a URL or bare.
        if (preg_match('~(?:youtube\.com/)?@([A-Za-z0-9._\-]{1,60})~i', $s, $m)) return ['type' => 'handle', 'value' => '@' . $m[1]];
        // Legacy /user/NAME
        if (preg_match('~/user/([A-Za-z0-9._\-]{1,80})~i', $s, $m)) return ['type' => 'username', 'value' => $m[1]];
        // Legacy /c/NAME custom URL — best-effort as a handle.
        if (preg_match('~/c/([A-Za-z0-9._\-]{1,80})~i', $s, $m)) return ['type' => 'handle', 'value' => '@' . $m[1]];
        // Bare handle typed without the @.
        if (preg_match('~^[A-Za-z0-9._\-]{1,60}$~', $s)) return ['type' => 'handle', 'value' => '@' . $s];
        return null;
    }

    /**
     * Resolve a channel URL/handle/id to a stable channel via the official API.
     * Returns ['id','title','uploads'] (uploads = the channel's uploads playlist
     * id, used for cheap live discovery). Throws on invalid/not-found.
     */
    public function resolveChannel(string $input): array {
        $p = self::parseChannelInput($input);
        if (!$p) throw new RuntimeException('yt:invalidChannel');
        $q = ['part' => 'snippet,contentDetails'];
        if ($p['type'] === 'id')            $q['id'] = $p['value'];
        elseif ($p['type'] === 'handle')    $q['forHandle'] = $p['value'];
        else                                $q['forUsername'] = $p['value'];
        $r = $this->get('channels', $q);
        $it = $r['items'][0] ?? null;
        if (!$it || empty($it['id'])) throw new RuntimeException('yt:channelNotFound');
        return [
            'id'      => (string)$it['id'],
            'title'   => (string)($it['snippet']['title'] ?? ''),
            'uploads' => (string)($it['contentDetails']['relatedPlaylists']['uploads'] ?? ''),
        ];
    }

    /** The uploads playlist id for a channel (cached by the caller). */
    public function uploadsPlaylistId(string $channelId): ?string {
        $r = $this->get('channels', ['part' => 'contentDetails', 'id' => $channelId]);
        return $r['items'][0]['contentDetails']['relatedPlaylists']['uploads'] ?? null;
    }

    /**
     * Find the channel's CURRENTLY active live broadcast (with an open chat) using
     * the cheap, quota-friendly path: the uploads playlist (1u) + videos.list (1u),
     * NOT search.list (100u). Active live broadcasts appear in the uploads playlist.
     * Returns ['videoId','liveChatId','title'] or null when the channel is offline.
     */
    public function findActiveLiveVideo(string $channelId, ?string $uploadsPlaylistId = null): ?array {
        $uploads = $uploadsPlaylistId ?: $this->uploadsPlaylistId($channelId);
        if (!$uploads) return null;
        $pl = $this->get('playlistItems', ['part' => 'contentDetails', 'playlistId' => $uploads, 'maxResults' => 10]);
        $ids = [];
        foreach ($pl['items'] ?? [] as $it) { $v = $it['contentDetails']['videoId'] ?? null; if ($v) $ids[] = $v; }
        if (!$ids) return null;
        $vr = $this->get('videos', ['part' => 'snippet,liveStreamingDetails', 'id' => implode(',', $ids)]);
        foreach ($vr['items'] ?? [] as $v) {
            $lsd    = $v['liveStreamingDetails'] ?? null;
            $isLive = (($v['snippet']['liveBroadcastContent'] ?? '') === 'live');
            $chatId = $lsd['activeLiveChatId'] ?? null;
            $ended  = !empty($lsd['actualEndTime']);
            if ($isLive && $chatId && !$ended) {
                return ['videoId' => (string)$v['id'], 'liveChatId' => (string)$chatId, 'title' => (string)($v['snippet']['title'] ?? '')];
            }
        }
        return null;
    }

    /**
     * Poll messages. Returns [messages[], nextPageToken, pollingIntervalMillis].
     * Each message is normalised to the renderer's shape.
     */
    public function messages(string $liveChatId, ?string $pageToken): array {
        $q = ['liveChatId' => $liveChatId, 'part' => 'snippet,authorDetails', 'maxResults' => 200];
        if ($pageToken) $q['pageToken'] = $pageToken;
        $r = $this->get('liveChat/messages', $q);
        $out = [];
        foreach ($r['items'] ?? [] as $it) {
            $sn = $it['snippet'] ?? [];
            $au = $it['authorDetails'] ?? [];
            $msg = [
                'id'        => $it['id'] ?? null,
                'author'    => $au['displayName'] ?? 'Viewer',
                'authorId'  => $au['channelId'] ?? ($au['displayName'] ?? ''),
                'avatar'    => $au['profileImageUrl'] ?? '',
                'message'   => $sn['displayMessage'] ?? ($sn['textMessageDetails']['messageText'] ?? ''),
                'timestamp' => $sn['publishedAt'] ?? null,
                'owner'     => !empty($au['isChatOwner']),
                'moderator' => !empty($au['isChatModerator']),
                'member'    => !empty($au['isChatSponsor']),
            ];
            $type = $sn['type'] ?? 'textMessageEvent';
            if ($type === 'superChatEvent') {
                $d = $sn['superChatDetails'] ?? [];
                $msg['message'] = $d['userComment'] ?? '';
                $msg['superChat'] = [
                    'amount'       => $d['amountDisplayString'] ?? '',
                    'amountMicros' => (int)($d['amountMicros'] ?? 0),
                    'currency'     => $d['currency'] ?? '',
                ];
            } elseif ($type === 'superStickerEvent') {
                $d = $sn['superStickerDetails'] ?? [];
                $msg['superSticker'] = [
                    'amount'       => $d['amountDisplayString'] ?? '',
                    'amountMicros' => (int)($d['amountMicros'] ?? 0),
                    'currency'     => $d['currency'] ?? '',
                    'altText'      => $d['superStickerMetadata']['altText'] ?? '',
                ];
            }
            $out[] = $msg;
        }
        return [$out, $r['nextPageToken'] ?? null, (int)($r['pollingIntervalMillis'] ?? 4000)];
    }
}
