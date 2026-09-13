import { get, run } from '../db.js';
import { uid, nowIso } from '../util.js';

// ---------------------------------------------------------------------------
// Visual themes (palettes + fonts). Each system template is a structured JSON
// configuration — never a flattened image — so users can fully customize it.
// ---------------------------------------------------------------------------
const THEMES = {
  classic:      { bg: ['#14142e', '#1f1f4d'], accent: '#e94560', text: '#ffffff', font: 'Arial' },
  minimal:      { bg: ['#0d0d0d', '#1c1c1c'], accent: '#ffffff', text: '#ffffff', font: 'Arial' },
  neon:         { bg: ['#07071f', '#1a0b2e'], accent: '#00f5ff', text: '#ffffff', font: 'Arial' },
  gaming:       { bg: ['#0f0c29', '#302b63'], accent: '#ff4d4d', text: '#ffffff', font: 'Arial' },
  fire:         { bg: ['#1a0202', '#4d0f0f'], accent: '#ff7b00', text: '#ffffff', font: 'Arial' },
  celebration:  { bg: ['#1b1035', '#3b1f6e'], accent: '#ffd700', text: '#ffffff', font: 'Arial' },
  cute:         { bg: ['#2a1a3a', '#4a2a5a'], accent: '#ff9ecf', text: '#ffffff', font: 'Arial' },
  cyberpunk:    { bg: ['#0d0221', '#3a0ca3'], accent: '#f72585', text: '#ffffff', font: 'Arial' },
  luxury:       { bg: ['#0c0c0c', '#2b2b1a'], accent: '#d4af37', text: '#ffffff', font: 'Georgia' },
  retro:        { bg: ['#2d0a3d', '#12002b'], accent: '#ff00ff', text: '#ffffff', font: 'Arial' },
  futuristic:   { bg: ['#001a2e', '#003b5c'], accent: '#00e5ff', text: '#ffffff', font: 'Arial' },
  halloween:    { bg: ['#0d0d0d', '#2b1a00'], accent: '#ff7518', text: '#ffffff', font: 'Arial' },
  christmas:    { bg: ['#0a1f0a', '#1f3d1f'], accent: '#ff4d4d', text: '#ffffff', font: 'Arial' },
  money:        { bg: ['#0a2e0a', '#1f5c1f'], accent: '#7cfc00', text: '#ffffff', font: 'Arial' },
  royal:        { bg: ['#1a0b2e', '#3b1f6e'], accent: '#c77dff', text: '#ffffff', font: 'Georgia' },
  epic:         { bg: ['#1a0a00', '#4d1a00'], accent: '#ff9f1c', text: '#ffffff', font: 'Arial' },
};

const EASINGS = {
  pop: 'cubic-bezier(.34,1.56,.64,1)',
  bounce: 'cubic-bezier(.28,.84,.42,1)',
  elastic: 'cubic-bezier(.68,-0.55,.27,1.55)',
  smooth: 'cubic-bezier(.22,1,.36,1)',
};

function entrance(type, duration = 600, delay = 0, intensity = 1) {
  return { type, duration, delay, easing: EASINGS[type] || EASINGS.smooth, intensity };
}

function glow(color, blur = 20, intensity = 1) {
  return { color, blur, intensity };
}

function shadow(color = 'rgba(0,0,0,.55)', blur = 14, x = 0, y = 4) {
  return { color, blur, x, y };
}

function textLayer(id, text, y, size, theme, opts = {}) {
  return {
    id,
    type: 'text',
    text,
    position: { x: 50, y, align: 'center' },
    style: {
      font: opts.font || theme.font,
      size,
      weight: opts.weight ?? 700,
      color: opts.color || theme.text,
      gradient: opts.gradient || null,
      stroke: opts.stroke || { color: '#000000', width: 0 },
      shadow: opts.shadow ?? shadow(),
      glow: opts.glow || null,
      letterSpacing: opts.spacing || 0,
      lineHeight: 1.2,
    },
    animation: {
      entrance: opts.entrance || entrance('pop'),
      idle: opts.idle || { type: 'none' },
      exit: opts.exit || { type: 'fade', duration: 400, delay: 0 },
    },
  };
}

function imageLayer(id, source, y, w, h, theme, opts = {}) {
  return {
    id,
    type: 'image',
    source,
    shape: opts.shape || 'circle',
    position: { x: 50, y, align: 'center' },
    size: { width: w, height: h },
    style: {
      shadow: opts.shadow ?? shadow(),
      glow: opts.glow || null,
      border: opts.border || { color: theme.accent, width: 3 },
    },
    animation: {
      entrance: opts.entrance || entrance('pop'),
      idle: opts.idle || { type: 'none' },
      exit: opts.exit || { type: 'fade', duration: 400, delay: 0 },
    },
  };
}

function particlesLayer(id, opts = {}) {
  return {
    id,
    type: 'particles',
    position: { x: 50, y: 50, align: 'center' },
    style: {
      count: opts.count || 40,
      color: opts.color || '#ffffff',
      speed: opts.speed || 1,
      spread: opts.spread || 100,
      gravity: opts.gravity ?? 0.2,
      shape: opts.shape || 'circle',
    },
    animation: { entrance: { type: 'fade', duration: 400, delay: 0 }, idle: { type: 'none' }, exit: { type: 'fade', duration: 400, delay: 0 } },
  };
}

function buildConfig({ eventType, theme, bgType = 'gradient', entranceType = 'pop', sound = null, duration = 6000, extra = {} }) {
  const t = THEMES[theme] || THEMES.classic;
  const exitDelay = Math.max(0, duration - 500);

  const background = { type: bgType, effects: { blur: 0, brightness: 100, contrast: 100, saturation: 100, opacity: 100, glow: 0 } };
  if (bgType === 'gradient') background.gradient = { colors: t.bg, angle: 135 };
  if (bgType === 'solid') background.color = t.bg[0];
  if (bgType === 'animated-gradient') background.animatedGradient = { colors: [t.bg[0], t.accent, t.bg[1]], speed: 10 };
  if (bgType === 'particles') { background.gradient = { colors: t.bg, angle: 135 }; background.particles = { count: 30, color: t.accent, speed: 1 }; }
  background.animation = { type: extra.bgAnim || 'zoom', duration: duration + 2000, intensity: 1 };

  const layers = [];
  const push = (l) => { l.animation.exit.delay = exitDelay; layers.push(l); };

  switch (eventType) {
    case 'SUBSCRIBER': {
      push(imageLayer('profile', '{profile_picture}', 30, 130, 130, t, { entrance: entrance(entranceType, 500) }));
      push(textLayer('username', '{username}', 46, 64, t, { glow: glow(t.accent, 18), entrance: entrance(entranceType, 600, 120) }));
      push(textLayer('subtitle', extra.subtitle || 'just subscribed!', 54, 34, t, { weight: 600, color: t.accent, entrance: entrance('fade', 500, 300) }));
      push(particlesLayer('confetti', { color: t.accent, count: 50, speed: 1.2, gravity: 0.25 }));
      break;
    }
    case 'SUPER_CHAT': {
      push(textLayer('username', '{username}', 26, 40, t, { weight: 600, entrance: entrance('fade', 400, 0) }));
      push(textLayer('amount', '{amount} {currency}', 40, 88, t, { glow: glow(t.accent, 24), gradient: { colors: [t.accent, '#ffffff'], angle: 90 }, entrance: entrance(entranceType, 700, 80) }));
      push(textLayer('message', '{message}', 54, 30, t, { weight: 500, entrance: entrance('fade', 500, 300) }));
      push(particlesLayer('money', { color: t.accent, count: 45, speed: 1.1, gravity: 0.3, shape: 'square' }));
      break;
    }
    case 'SUPER_STICKER': {
      push(imageLayer('sticker', '{sticker}', 36, 150, 150, t, { shape: 'square', entrance: entrance(entranceType, 600) }));
      push(textLayer('username', '{username}', 52, 44, t, { glow: glow(t.accent, 16), entrance: entrance('fade', 400, 150) }));
      push(textLayer('amount', '{amount} {currency}', 60, 30, t, { weight: 600, color: t.accent, entrance: entrance('fade', 400, 250) }));
      push(particlesLayer('burst', { color: t.accent, count: 40, speed: 1.3, gravity: 0.2 }));
      break;
    }
    case 'NEW_MEMBER':
    case 'MEMBER_MILESTONE': {
      push(imageLayer('badge', '{profile_picture}', 28, 120, 120, t, { entrance: entrance(entranceType, 500) }));
      push(textLayer('username', '{username}', 44, 58, t, { glow: glow(t.accent, 18), entrance: entrance(entranceType, 600, 100) }));
      push(textLayer('subtitle', eventType === 'NEW_MEMBER' ? 'is now a member!' : '{message}', 53, 32, t, { weight: 600, color: t.accent, entrance: entrance('fade', 500, 280) }));
      push(textLayer('level', '{membership_level}', 60, 26, t, { weight: 500, entrance: entrance('fade', 500, 380) }));
      push(particlesLayer('sparkle', { color: t.accent, count: 35, speed: 1, gravity: 0.15 }));
      break;
    }
    case 'GIFT_MEMBERSHIP':
    case 'GIFT_MEMBERSHIP_RECEIVED': {
      push(textLayer('username', '{username}', 36, 54, t, { glow: glow(t.accent, 18), entrance: entrance(entranceType, 600) }));
      push(textLayer('subtitle', eventType === 'GIFT_MEMBERSHIP' ? 'gifted {gift_count} membership(s)!' : 'received a membership!', 48, 36, t, { weight: 600, color: t.accent, entrance: entrance('fade', 500, 200) }));
      push(particlesLayer('gift', { color: t.accent, count: 55, speed: 1.2, gravity: 0.35 }));
      break;
    }
    case 'LIVE_START': {
      push(textLayer('badge', '● LIVE', 34, 72, t, { color: '#ff3b3b', glow: glow('#ff3b3b', 30), entrance: entrance('pop', 600) }));
      push(textLayer('channel', '{channel_name}', 48, 46, t, { entrance: entrance('fade', 500, 150) }));
      push(textLayer('title', '{stream_title}', 56, 28, t, { weight: 500, entrance: entrance('fade', 500, 300) }));
      break;
    }
    case 'LIVE_END': {
      push(textLayer('thanks', extra.title || 'Thanks for watching!', 40, 60, t, { glow: glow(t.accent, 20), entrance: entrance('fade', 700) }));
      push(textLayer('channel', '{channel_name}', 52, 32, t, { weight: 500, entrance: entrance('fade', 500, 250) }));
      break;
    }
    case 'MILESTONE': {
      push(textLayer('count', '{subscriber_count}', 36, 96, t, { gradient: { colors: [t.accent, '#ffffff'], angle: 90 }, glow: glow(t.accent, 24), entrance: entrance(entranceType, 800) }));
      push(textLayer('subtitle', 'Subscribers!', 52, 40, t, { weight: 600, entrance: entrance('fade', 500, 250) }));
      push(particlesLayer('celebrate', { color: t.accent, count: 70, speed: 1.4, gravity: 0.25 }));
      break;
    }
  }

  return {
    duration,
    canvas: { width: 1920, height: 1080 },
    background,
    layers,
    sound: sound ? { source: sound, volume: 0.8 } : { source: null, volume: 0.8 },
  };
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------
const T = (slug, name, description, eventType, category, style, orientation, tags, opts) => ({
  slug, name, description, eventType, category, style, orientation,
  tags, isPremium: opts.premium || false,
  configuration: buildConfig({ eventType, ...opts }),
});

const LIBRARY = [
  // Subscriber
  T('subscriber-classic', 'Classic Subscribe', 'A timeless subscriber alert with profile picture and confetti.', 'SUBSCRIBER', 'Subscriber', 'Classic', '16:9', ['subscriber', 'classic', 'animated'], { theme: 'classic', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:subscriber' }),
  T('subscriber-minimal', 'Minimal Subscribe', 'Clean, understated subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Minimal', '16:9', ['subscriber', 'minimal', 'clean'], { theme: 'minimal', bgType: 'solid', entranceType: 'fade', sound: 'builtin:minimal' }),
  T('subscriber-neon', 'Neon Subscribe', 'Glowing neon subscriber alert for late-night streams.', 'SUBSCRIBER', 'Subscriber', 'Neon', '16:9', ['subscriber', 'neon', 'glow'], { theme: 'neon', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:subscriber' }),
  T('subscriber-gaming', 'Gaming Subscribe', 'Bold gaming-style subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Gaming', '16:9', ['subscriber', 'gaming', 'bold'], { theme: 'gaming', bgType: 'gradient', entranceType: 'bounce', sound: 'builtin:gaming' }),
  T('subscriber-fire', 'Fire Subscribe', 'Hot fire-themed subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Fire', '16:9', ['subscriber', 'fire', 'hot'], { theme: 'fire', bgType: 'particles', entranceType: 'pop', sound: 'builtin:epic' }),
  T('subscriber-celebration', 'Celebration Subscribe', 'Party confetti subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Celebration', '16:9', ['subscriber', 'celebration', 'party'], { theme: 'celebration', bgType: 'gradient', entranceType: 'elastic', sound: 'builtin:celebration' }),
  T('subscriber-cute', 'Cute Subscribe', 'Soft and cute subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Cute', '16:9', ['subscriber', 'cute', 'soft'], { theme: 'cute', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:funny' }),
  T('subscriber-cyberpunk', 'Cyberpunk Subscribe', 'Futuristic cyberpunk subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Cyberpunk', '16:9', ['subscriber', 'cyberpunk', 'futuristic'], { theme: 'cyberpunk', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:gaming' }),

  // Super Chat
  T('super-chat-classic', 'Classic Super Chat', 'Clean super chat alert with amount and message.', 'SUPER_CHAT', 'Super Chat', 'Classic', '16:9', ['super-chat', 'classic', 'money'], { theme: 'classic', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:money' }),
  T('super-chat-money-burst', 'Money Burst', 'Cash explosion super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Money', '16:9', ['super-chat', 'money', 'cash'], { theme: 'money', bgType: 'particles', entranceType: 'bounce', sound: 'builtin:money' }),
  T('super-chat-neon', 'Neon Super Chat', 'Neon-glowing super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Neon', '16:9', ['super-chat', 'neon', 'glow'], { theme: 'neon', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:money' }),
  T('super-chat-fire', 'Fire Super Chat', 'Blazing super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Fire', '16:9', ['super-chat', 'fire', 'hot'], { theme: 'fire', bgType: 'particles', entranceType: 'pop', sound: 'builtin:epic' }),
  T('super-chat-epic', 'Epic Super Chat', 'Full-impact epic super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Epic', '16:9', ['super-chat', 'epic', 'premium'], { theme: 'epic', bgType: 'animated-gradient', entranceType: 'elastic', sound: 'builtin:epic', premium: true }),
  T('super-chat-cyberpunk', 'Cyberpunk Super Chat', 'Neon cyberpunk super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Cyberpunk', '16:9', ['super-chat', 'cyberpunk', 'neon'], { theme: 'cyberpunk', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:gaming' }),
  T('super-chat-luxury', 'Luxury Super Chat', 'Gold luxury super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Luxury', '16:9', ['super-chat', 'luxury', 'gold', 'premium'], { theme: 'luxury', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:money', premium: true }),
  T('super-chat-fullscreen', 'Fullscreen Super Chat', 'Immersive fullscreen super chat takeover.', 'SUPER_CHAT', 'Super Chat', 'Fullscreen', '16:9', ['super-chat', 'fullscreen', 'epic'], { theme: 'epic', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:epic', premium: true }),

  // Member
  T('member-crown', 'Crown Member', 'Royal crown new member alert.', 'NEW_MEMBER', 'Member', 'Royal', '16:9', ['member', 'crown', 'royal'], { theme: 'royal', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:membership' }),
  T('member-royal', 'Royal Member', 'Elegant royal membership alert.', 'NEW_MEMBER', 'Member', 'Royal', '16:9', ['member', 'royal', 'elegant'], { theme: 'royal', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:membership' }),
  T('member-gaming', 'Gaming Member', 'Gaming-style membership alert.', 'NEW_MEMBER', 'Member', 'Gaming', '16:9', ['member', 'gaming'], { theme: 'gaming', bgType: 'gradient', entranceType: 'bounce', sound: 'builtin:gaming' }),
  T('member-neon', 'Neon Member', 'Neon membership alert.', 'NEW_MEMBER', 'Member', 'Neon', '16:9', ['member', 'neon', 'glow'], { theme: 'neon', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:membership' }),
  T('member-vip', 'VIP Member', 'Premium VIP membership alert.', 'NEW_MEMBER', 'Member', 'VIP', '16:9', ['member', 'vip', 'premium'], { theme: 'luxury', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:membership', premium: true }),
  T('member-celebration', 'Celebration Member', 'Party membership alert.', 'NEW_MEMBER', 'Member', 'Celebration', '16:9', ['member', 'celebration', 'party'], { theme: 'celebration', bgType: 'particles', entranceType: 'elastic', sound: 'builtin:celebration' }),

  // Super Sticker
  T('super-sticker-pop', 'Sticker Pop', 'Playful super sticker alert.', 'SUPER_STICKER', 'Super Sticker', 'Funny', '16:9', ['super-sticker', 'pop', 'fun'], { theme: 'celebration', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:funny' }),
  T('super-sticker-neon', 'Neon Sticker', 'Neon super sticker alert.', 'SUPER_STICKER', 'Super Sticker', 'Neon', '16:9', ['super-sticker', 'neon'], { theme: 'neon', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:money' }),
  T('super-sticker-explosion', 'Sticker Explosion', 'Explosive super sticker alert.', 'SUPER_STICKER', 'Super Sticker', 'Fire', '16:9', ['super-sticker', 'explosion', 'epic'], { theme: 'fire', bgType: 'particles', entranceType: 'bounce', sound: 'builtin:epic' }),
  T('super-sticker-celebration', 'Sticker Celebration', 'Confetti super sticker alert.', 'SUPER_STICKER', 'Super Sticker', 'Celebration', '16:9', ['super-sticker', 'celebration'], { theme: 'celebration', bgType: 'gradient', entranceType: 'elastic', sound: 'builtin:celebration' }),

  // Gift Membership
  T('gift-box', 'Gift Box', 'Classic gift membership alert.', 'GIFT_MEMBERSHIP', 'Gift Membership', 'Classic', '16:9', ['gift', 'classic'], { theme: 'celebration', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:gift' }),
  T('gift-explosion', 'Gift Explosion', 'Explosive gift membership alert.', 'GIFT_MEMBERSHIP', 'Gift Membership', 'Fire', '16:9', ['gift', 'explosion'], { theme: 'fire', bgType: 'particles', entranceType: 'bounce', sound: 'builtin:gift' }),
  T('gift-membership-rain', 'Membership Rain', 'Raining gifts membership alert.', 'GIFT_MEMBERSHIP', 'Gift Membership', 'Celebration', '16:9', ['gift', 'rain', 'party'], { theme: 'celebration', bgType: 'particles', entranceType: 'pop', sound: 'builtin:gift' }),
  T('gift-party', 'Party Gift', 'Party gift membership alert.', 'GIFT_MEMBERSHIP', 'Gift Membership', 'Celebration', '16:9', ['gift', 'party'], { theme: 'celebration', bgType: 'animated-gradient', entranceType: 'elastic', sound: 'builtin:celebration' }),
  T('gift-royal', 'Royal Gift', 'Luxury royal gift alert.', 'GIFT_MEMBERSHIP', 'Gift Membership', 'Royal', '16:9', ['gift', 'royal', 'premium'], { theme: 'royal', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:gift', premium: true }),

  // Live Start
  T('live-now', 'LIVE Now', 'Clean live-start alert.', 'LIVE_START', 'LIVE Start', 'Classic', '16:9', ['live', 'start', 'classic'], { theme: 'classic', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:live' }),
  T('live-gaming-start', 'Gaming Start', 'Gaming live-start alert.', 'LIVE_START', 'LIVE Start', 'Gaming', '16:9', ['live', 'start', 'gaming'], { theme: 'gaming', bgType: 'gradient', entranceType: 'bounce', sound: 'builtin:gaming' }),
  T('live-neon-start', 'Neon Start', 'Neon live-start alert.', 'LIVE_START', 'LIVE Start', 'Neon', '16:9', ['live', 'start', 'neon'], { theme: 'neon', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:live' }),
  T('live-epic-start', 'Epic Start', 'Epic live-start alert.', 'LIVE_START', 'LIVE Start', 'Epic', '16:9', ['live', 'start', 'epic'], { theme: 'epic', bgType: 'animated-gradient', entranceType: 'elastic', sound: 'builtin:epic', premium: true }),
  T('live-minimal-start', 'Minimal Start', 'Minimal live-start alert.', 'LIVE_START', 'LIVE Start', 'Minimal', '16:9', ['live', 'start', 'minimal'], { theme: 'minimal', bgType: 'solid', entranceType: 'fade', sound: 'builtin:minimal' }),

  // Live End
  T('thanks-for-watching', 'Thanks for Watching', 'Warm stream-end alert.', 'LIVE_END', 'LIVE End', 'Classic', '16:9', ['live', 'end', 'classic'], { theme: 'classic', bgType: 'gradient', entranceType: 'fade', sound: 'builtin:end' }),
  T('good-night', 'Good Night', 'Cozy good-night stream end.', 'LIVE_END', 'LIVE End', 'Minimal', '16:9', ['live', 'end', 'minimal'], { theme: 'minimal', bgType: 'solid', entranceType: 'fade', sound: 'builtin:end' }),
  T('see-you-next-time', 'See You Next Time', 'Friendly stream-end alert.', 'LIVE_END', 'LIVE End', 'Classic', '16:9', ['live', 'end'], { theme: 'celebration', bgType: 'gradient', entranceType: 'fade', sound: 'builtin:end' }),
  T('gaming-end', 'Gaming End', 'Gaming stream-end alert.', 'LIVE_END', 'LIVE End', 'Gaming', '16:9', ['live', 'end', 'gaming'], { theme: 'gaming', bgType: 'gradient', entranceType: 'fade', sound: 'builtin:gaming' }),
  T('minimal-end', 'Minimal End', 'Minimal stream-end alert.', 'LIVE_END', 'LIVE End', 'Minimal', '16:9', ['live', 'end', 'minimal'], { theme: 'minimal', bgType: 'solid', entranceType: 'fade', sound: 'builtin:minimal' }),

  // Milestone
  T('milestone-100', '100 Subscribers', '100 subscriber milestone.', 'MILESTONE', 'Milestone', 'Celebration', '16:9', ['milestone', '100', 'celebration'], { theme: 'celebration', bgType: 'gradient', entranceType: 'pop', sound: 'builtin:celebration' }),
  T('milestone-500', '500 Subscribers', '500 subscriber milestone.', 'MILESTONE', 'Milestone', 'Celebration', '16:9', ['milestone', '500'], { theme: 'celebration', bgType: 'particles', entranceType: 'elastic', sound: 'builtin:celebration' }),
  T('milestone-1k', '1K Subscribers', '1,000 subscriber milestone.', 'MILESTONE', 'Milestone', 'Celebration', '16:9', ['milestone', '1k'], { theme: 'celebration', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:celebration' }),
  T('milestone-5k', '5K Subscribers', '5,000 subscriber milestone.', 'MILESTONE', 'Milestone', 'Epic', '16:9', ['milestone', '5k'], { theme: 'epic', bgType: 'animated-gradient', entranceType: 'elastic', sound: 'builtin:epic' }),
  T('milestone-10k', '10K Subscribers', '10,000 subscriber milestone.', 'MILESTONE', 'Milestone', 'Epic', '16:9', ['milestone', '10k', 'premium'], { theme: 'epic', bgType: 'particles', entranceType: 'pop', sound: 'builtin:epic', premium: true }),
  T('milestone-50k', '50K Subscribers', '50,000 subscriber milestone.', 'MILESTONE', 'Milestone', 'Luxury', '16:9', ['milestone', '50k', 'premium'], { theme: 'luxury', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:epic', premium: true }),
  T('milestone-100k', '100K Subscribers', '100,000 subscriber milestone.', 'MILESTONE', 'Milestone', 'Luxury', '16:9', ['milestone', '100k', 'premium'], { theme: 'luxury', bgType: 'animated-gradient', entranceType: 'elastic', sound: 'builtin:epic', premium: true }),
];

// A few vertical (9:16) and square (1:1) variants for orientation support.
const ORIENTATION_VARIANTS = [
  T('subscriber-neon-vertical', 'Neon Subscribe (Vertical)', 'Vertical neon subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Neon', '9:16', ['subscriber', 'neon', 'vertical'], { theme: 'neon', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:subscriber' }),
  T('super-chat-epic-vertical', 'Epic Super Chat (Vertical)', 'Vertical epic super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Epic', '9:16', ['super-chat', 'epic', 'vertical', 'premium'], { theme: 'epic', bgType: 'animated-gradient', entranceType: 'elastic', sound: 'builtin:epic', premium: true }),
  T('subscriber-minimal-square', 'Minimal Subscribe (Square)', 'Square minimal subscriber alert.', 'SUBSCRIBER', 'Subscriber', 'Minimal', '1:1', ['subscriber', 'minimal', 'square'], { theme: 'minimal', bgType: 'solid', entranceType: 'fade', sound: 'builtin:minimal' }),
  T('super-chat-neon-square', 'Neon Super Chat (Square)', 'Square neon super chat alert.', 'SUPER_CHAT', 'Super Chat', 'Neon', '1:1', ['super-chat', 'neon', 'square'], { theme: 'neon', bgType: 'animated-gradient', entranceType: 'pop', sound: 'builtin:money' }),
];

export function seedTemplates() {
  const allTemplates = [...LIBRARY, ...ORIENTATION_VARIANTS];
  let inserted = 0;
  let order = 0;
  for (const t of allTemplates) {
    const existing = get('SELECT id FROM templates WHERE slug = ?', t.slug);
    if (existing) continue;
    run(
      `INSERT INTO templates (id, slug, name, description, event_type, category, style, orientation, tags, configuration, is_system, is_premium, version, status, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid('tpl'), t.slug, t.name, t.description, t.eventType, t.category, t.style, t.orientation,
      JSON.stringify(t.tags), JSON.stringify(t.configuration), 1, t.isPremium ? 1 : 0, 1, 'active', order++, nowIso(), nowIso()
    );
    inserted++;
  }
  if (inserted) console.log(`[seed] inserted ${inserted} system templates`);
  return inserted;
}
