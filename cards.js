// ============================================================
// PLAYER CARDS — Soccer Guru-inspired visual cards.
//
// The game ships without photo assets, so every card is drawn from
// CSS + inline SVG: a shield frame, a tier background, a stylised
// bust with the player's initials, and the classic 6-stat block.
// ============================================================

const CARD_TIER_META = Object.freeze({
    gold: { label: 'GOLD', min: 0 },
    elite: { label: 'ELITE', min: 96 },
    invincible: { label: 'INVINCIBLE', min: 101 },
    goat: { label: 'GOAT', min: 106 }
});

function cardTierOf(player) {
    const ovr = Number(player && player.rating) || 0;
    if (ovr >= 106) return 'goat';
    if (ovr >= 101) return 'invincible';
    if (ovr >= 96) return 'elite';
    return 'gold';
}

function cardRatingOf(player) {
    const ovr = Number(player && player.rating);
    return Number.isFinite(ovr) ? Math.round(ovr) : 85;
}

function cardEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function hashText(text) {
    let h = 2166136261;
    const str = String(text || '');
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const COUNTRY_CODES = Object.freeze({
    'Algeria': 'ALG', 'Argentina': 'ARG', 'Armenia': 'ARM', 'Austria': 'AUT',
    'Belgium': 'BEL', 'Bosnia and Herzegovina': 'BIH', 'Brazil': 'BRA', 'Bulgaria': 'BUL',
    'Cameroon': 'CMR', 'Canada': 'CAN', 'Chile': 'CHI', 'Colombia': 'COL',
    'Costa Rica': 'CRC', 'Croatia': 'CRO', 'Czech Republic': 'CZE', 'Denmark': 'DEN',
    'Ecuador': 'ECU', 'Egypt': 'EGY', 'England': 'ENG', 'France': 'FRA',
    'Georgia': 'GEO', 'Germany': 'GER', 'Ghana': 'GHA', 'Greece': 'GRE',
    'Guinea': 'GUI', 'Hungary': 'HUN', 'Iran': 'IRN', 'Ireland': 'IRL',
    'Israel': 'ISR', 'Italy': 'ITA', 'Ivory Coast': 'CIV', 'Jamaica': 'JAM',
    'Japan': 'JPN', 'Liberia': 'LBR', 'Mali': 'MLI', 'Mexico': 'MEX',
    'Morocco': 'MAR', 'Netherlands': 'NED', 'New Zealand': 'NZL', 'Nigeria': 'NGA',
    'Northern Ireland': 'NIR', 'Norway': 'NOR', 'Paraguay': 'PAR', 'Poland': 'POL',
    'Portugal': 'POR', 'Romania': 'ROU', 'Scotland': 'SCO', 'Senegal': 'SEN',
    'Serbia': 'SRB', 'Slovakia': 'SVK', 'Slovenia': 'SVN', 'South Korea': 'KOR',
    'Soviet Union': 'URS', 'Spain': 'ESP', 'Sweden': 'SWE', 'Switzerland': 'SUI',
    'Turkey': 'TUR', 'USA': 'USA', 'Ukraine': 'UKR', 'Uruguay': 'URU',
    'Wales': 'WAL', 'Yugoslavia': 'YUG', 'World': 'WLD'
});

function countryCodeOf(nationality) {
    const name = String(nationality || 'World');
    if (COUNTRY_CODES[name]) return COUNTRY_CODES[name];
    return name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'WLD';
}

// Small CSS flags keep the card readable on Windows, where emoji flags do not
// render. Anything not covered falls back to a tinted country-code badge.
const FLAG_CSS = Object.freeze({
    'Algeria': 'linear-gradient(90deg,#006233 0 50%,#fff 50%)',
    'Argentina': 'linear-gradient(180deg,#74ACDF 0 33.33%,#fff 33.33% 66.66%,#74ACDF 66.66%)',
    'Armenia': 'linear-gradient(180deg,#D90012 0 33.33%,#0033A0 33.33% 66.66%,#F2A800 66.66%)',
    'Austria': 'linear-gradient(180deg,#ED2939 0 33.33%,#fff 33.33% 66.66%,#ED2939 66.66%)',
    'Belgium': 'linear-gradient(90deg,#000 0 33.33%,#FAE042 33.33% 66.66%,#ED2939 66.66%)',
    'Bosnia and Herzegovina': 'linear-gradient(135deg,transparent 0 42%,#FECB00 42% 58%,transparent 58%),#002F6C',
    'Brazil': 'radial-gradient(circle at 50% 50%,#002776 0 10%,transparent 11%),radial-gradient(circle at 50% 50%,#FEDD00 0 31%,transparent 32%),#009C3B',
    'Bulgaria': 'linear-gradient(180deg,#fff 0 33.33%,#00966E 33.33% 66.66%,#D62612 66.66%)',
    'Cameroon': 'linear-gradient(90deg,#007A5E 0 33.33%,#CE1126 33.33% 66.66%,#FCD116 66.66%)',
    'Canada': 'linear-gradient(90deg,#D80621 0 25%,#fff 25% 75%,#D80621 75%)',
    'Chile': 'linear-gradient(180deg,#fff 0 50%,#D52B1E 50%)',
    'Colombia': 'linear-gradient(180deg,#FCD116 0 50%,#003893 50% 75%,#CE1126 75%)',
    'Costa Rica': 'linear-gradient(180deg,#002B7F 0 20%,#fff 20% 40%,#CE1126 40% 60%,#fff 60% 80%,#002B7F 80%)',
    'Croatia': 'linear-gradient(180deg,#FF0000 0 33.33%,#fff 33.33% 66.66%,#171796 66.66%)',
    'Czech Republic': 'linear-gradient(135deg,#11457E 0 35%,transparent 35%),linear-gradient(180deg,#fff 0 50%,#D7141A 50%)',
    'Denmark': 'linear-gradient(90deg,transparent 0 28%,#fff 28% 42%,transparent 42%),linear-gradient(180deg,transparent 0 40%,#fff 40% 54%,transparent 54%),#C8102E',
    'Ecuador': 'linear-gradient(180deg,#FFDD00 0 50%,#034EA2 50% 75%,#ED1C24 75%)',
    'Egypt': 'linear-gradient(180deg,#CE1126 0 33.33%,#fff 33.33% 66.66%,#000 66.66%)',
    'England': 'linear-gradient(90deg,transparent 0 41%,#CE1124 41% 59%,transparent 59%),linear-gradient(180deg,transparent 0 35%,#CE1124 35% 65%,transparent 65%),#fff',
    'France': 'linear-gradient(90deg,#0055A4 0 33.33%,#fff 33.33% 66.66%,#EF4135 66.66%)',
    'Georgia': 'linear-gradient(90deg,transparent 0 43%,#FF0000 43% 57%,transparent 57%),linear-gradient(180deg,transparent 0 41%,#FF0000 41% 59%,transparent 59%),#fff',
    'Germany': 'linear-gradient(180deg,#000 0 33.33%,#DD0000 33.33% 66.66%,#FFCE00 66.66%)',
    'Ghana': 'linear-gradient(180deg,#CE1126 0 33.33%,#FCD116 33.33% 66.66%,#006B3F 66.66%)',
    'Greece': 'repeating-linear-gradient(180deg,#0D5EAF 0 11.11%,#fff 11.11% 22.22%)',
    'Guinea': 'linear-gradient(90deg,#CE1126 0 33.33%,#FCD116 33.33% 66.66%,#009460 66.66%)',
    'Hungary': 'linear-gradient(180deg,#CE2939 0 33.33%,#fff 33.33% 66.66%,#477050 66.66%)',
    'Iran': 'linear-gradient(180deg,#239F40 0 33.33%,#fff 33.33% 66.66%,#DA0000 66.66%)',
    'Ireland': 'linear-gradient(90deg,#169B62 0 33.33%,#fff 33.33% 66.66%,#FF883E 66.66%)',
    'Israel': 'linear-gradient(180deg,#0038B8 0 12%,transparent 12% 88%,#0038B8 88%),#fff',
    'Italy': 'linear-gradient(90deg,#009246 0 33.33%,#fff 33.33% 66.66%,#CE2B37 66.66%)',
    'Ivory Coast': 'linear-gradient(90deg,#F77F00 0 33.33%,#fff 33.33% 66.66%,#009E60 66.66%)',
    'Jamaica': 'linear-gradient(45deg,transparent 0 45%,#FED100 45% 55%,transparent 55%),linear-gradient(-45deg,transparent 0 45%,#FED100 45% 55%,transparent 55%),#009B3A',
    'Japan': 'radial-gradient(circle at 50% 50%,#BC002D 0 30%,transparent 31%),#fff',
    'Liberia': 'repeating-linear-gradient(180deg,#BF0A30 0 9.09%,#fff 9.09% 18.18%)',
    'Mali': 'linear-gradient(90deg,#14B53A 0 33.33%,#FCD116 33.33% 66.66%,#CE1126 66.66%)',
    'Mexico': 'linear-gradient(90deg,#006847 0 33.33%,#fff 33.33% 66.66%,#CE1126 66.66%)',
    'Morocco': 'radial-gradient(circle at 50% 50%,#006233 0 22%,transparent 23%),#C1272D',
    'Netherlands': 'linear-gradient(180deg,#AE1C28 0 33.33%,#fff 33.33% 66.66%,#21468B 66.66%)',
    'New Zealand': 'linear-gradient(90deg,#00247D 0 50%,#CC142B 50%)',
    'Nigeria': 'linear-gradient(90deg,#008751 0 33.33%,#fff 33.33% 66.66%,#008751 66.66%)',
    'Northern Ireland': 'linear-gradient(90deg,transparent 0 41%,#CE1124 41% 59%,transparent 59%),linear-gradient(180deg,transparent 0 35%,#CE1124 35% 65%,transparent 65%),#fff',
    'Norway': 'linear-gradient(90deg,transparent 0 26%,#fff 26% 36%,#00205B 36% 46%,#fff 46% 56%,transparent 56%),linear-gradient(180deg,transparent 0 38%,#fff 38% 48%,#00205B 48% 58%,#fff 58% 68%,transparent 68%),#BA0C2F',
    'Paraguay': 'linear-gradient(180deg,#D52B1E 0 33.33%,#fff 33.33% 66.66%,#0038A8 66.66%)',
    'Poland': 'linear-gradient(180deg,#fff 0 50%,#DC143C 50%)',
    'Portugal': 'radial-gradient(circle at 40% 50%,#FFE900 0 18%,transparent 19%),linear-gradient(90deg,#046A38 0 40%,#DA291C 40%)',
    'Romania': 'linear-gradient(90deg,#002B7F 0 33.33%,#FCD116 33.33% 66.66%,#CE1126 66.66%)',
    'Scotland': 'linear-gradient(45deg,transparent 0 45%,#fff 45% 55%,transparent 55%),linear-gradient(-45deg,transparent 0 45%,#fff 45% 55%,transparent 55%),#005EB8',
    'Senegal': 'linear-gradient(90deg,#00853F 0 33.33%,#FDEF42 33.33% 66.66%,#E31B23 66.66%)',
    'Serbia': 'linear-gradient(180deg,#C6363C 0 33.33%,#0C4076 33.33% 66.66%,#fff 66.66%)',
    'Slovakia': 'linear-gradient(180deg,#fff 0 33.33%,#0B4EA2 33.33% 66.66%,#EE1C25 66.66%)',
    'Slovenia': 'linear-gradient(180deg,#fff 0 33.33%,#005DA4 33.33% 66.66%,#ED1C24 66.66%)',
    'South Korea': 'radial-gradient(circle at 50% 50%,#CD2E3A 0 24%,#0047A0 25% 33%,transparent 34%),#fff',
    'Soviet Union': 'radial-gradient(circle at 24% 50%,#FFD700 0 12%,transparent 13%),#CC0000',
    'Spain': 'linear-gradient(180deg,#AA151B 0 25%,#F1BF00 25% 75%,#AA151B 75%)',
    'Sweden': 'linear-gradient(90deg,transparent 0 28%,#FECC02 28% 42%,transparent 42%),linear-gradient(180deg,transparent 0 40%,#FECC02 40% 54%,transparent 54%),#006AA7',
    'Switzerland': 'linear-gradient(90deg,transparent 0 41%,#fff 41% 59%,transparent 59%),linear-gradient(180deg,transparent 0 41%,#fff 41% 59%,transparent 59%),#D52B1E',
    'Turkey': 'radial-gradient(circle at 62% 50%,#fff 0 13%,transparent 14%),radial-gradient(circle at 48% 50%,#E30A17 0 20%,transparent 21%),#E30A17',
    'USA': 'linear-gradient(90deg,#3C3B6E 0 38%,transparent 38%) 0 0/100% 55% no-repeat,repeating-linear-gradient(180deg,#B22234 0 7.69%,#fff 7.69% 15.38%)',
    'Ukraine': 'linear-gradient(180deg,#0057B7 0 50%,#FFD700 50%)',
    'Uruguay': 'radial-gradient(circle at 24% 30%,#FCD116 0 10%,transparent 11%),repeating-linear-gradient(180deg,#fff 0 12.5%,#5CBFEB 12.5% 25%)',
    'Wales': 'linear-gradient(180deg,#fff 0 50%,#00B140 50%)',
    'Yugoslavia': 'linear-gradient(180deg,#003893 0 33.33%,#fff 33.33% 66.66%,#CE1126 66.66%)'
});

function countryFlagMarkup(nationality) {
    const name = String(nationality || 'World');
    const css = FLAG_CSS[name];
    if (css) {
        return `<span class="pcard__flag" style="background:${css}" title="${cardEscape(name)}"></span>`;
    }
    const code = countryCodeOf(name);
    const hue = hashText(name) % 360;
    return `<span class="pcard__flag pcard__flag--code" style="--flag-hue:${hue}" title="${cardEscape(name)}"><i>${cardEscape(code)}</i></span>`;
}

// A short, stable palette per club keeps a squad visually recognisable without
// shipping 600 crest images.
const CLUB_COLORS = Object.freeze({
    'Real Madrid': ['#f8fafc', '#c7a24a'],
    'Barcelona': ['#a50044', '#004d98'],
    'Manchester United': ['#da291c', '#7a0f0a'],
    'Manchester City': ['#6cabdd', '#1c4f7c'],
    'Liverpool': ['#c8102e', '#7a0a1c'],
    'Chelsea': ['#034694', '#001f4d'],
    'Arsenal': ['#ef0107', '#7a0a05'],
    'Tottenham Hotspur': ['#132257', '#f8fafc'],
    'Bayern Munich': ['#dc052d', '#7a0219'],
    'Borussia Dortmund': ['#fde100', '#111111'],
    'Juventus': ['#111111', '#f8fafc'],
    'Milan': ['#fb090b', '#111111'],
    'Inter': ['#0068a8', '#111111'],
    'PSG': ['#004170', '#da291c'],
    'Ajax': ['#d2122e', '#f8fafc'],
    'Benfica': ['#e83030', '#f8fafc'],
    'Porto': ['#00428c', '#f8fafc'],
    'Atlético Madrid': ['#cb3524', '#1c2c5b'],
    'Sevilla': ['#d81920', '#f8fafc'],
    'Napoli': ['#12a0d7', '#0b4f7a'],
    'Roma': ['#8e1f2f', '#f0bc42'],
    'Lazio': ['#87d8f7', '#0b3d6b'],
    'Boca Juniors': ['#103f79', '#f2c14e'],
    'River Plate': ['#f8fafc', '#d71920'],
    'Santos': ['#f8fafc', '#111111'],
    'Flamengo': ['#c52613', '#111111'],
    'Celtic': ['#018749', '#f8fafc'],
    'Rangers': ['#1b458f', '#d71920'],
    'Galatasaray': ['#f2b705', '#a51c1c'],
    'Fenerbahçe': ['#f2c200', '#0b2a5b']
});

function teamPalette(team) {
    const key = String(team || '').trim();
    if (CLUB_COLORS[key]) return { c1: CLUB_COLORS[key][0], c2: CLUB_COLORS[key][1] };
    const hue = hashText(key || 'Free agent') % 360;
    return {
        c1: `hsl(${hue} 62% 46%)`,
        c2: `hsl(${(hue + 28) % 360} 66% 26%)`
    };
}

function clubAbbr(team) {
    const words = String(team || 'FA').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length >= 2) return words.slice(0, 3).map(word => word[0]).join('').toUpperCase().slice(0, 3);
    return (words[0] || 'FA').slice(0, 3).toUpperCase();
}

function playerInitials(name) {
    const parts = String(name || '').replace(/[^\p{L}\s.'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function playerShirtNumber(player) {
    if (player && player.mainPos === 'GK') return 1;
    return (hashText(player && player.name) % 99) + 1;
}

function cardPositions(player) {
    if (!player) return '';
    return [player.mainPos, ...(Array.isArray(player.subPos) ? player.subPos : [])]
        .filter(Boolean).join(' / ');
}

let cardArtworkSequence = 0;

function playerHairSvg(name) {
    const style = hashText(name) % 5;
    const shades = ['#211b20', '#50362b', '#af8041', '#33252a'];
    const color = shades[hashText(`${name}:hair`) % shades.length];
    const shapes = [
        'M69 65 Q60 44 73 33 Q75 20 92 24 Q105 11 120 28 Q138 31 132 60 L127 71 L123 47 Q104 54 84 42 L75 70 Z',
        'M68 65 Q59 52 66 43 Q58 29 73 26 Q73 14 88 20 Q98 8 110 20 Q125 14 129 27 Q143 28 137 42 Q142 53 131 65 L125 49 Q113 43 107 49 Q93 39 81 49 L75 69 Z',
        'M68 68 L68 39 Q78 17 103 23 Q132 22 134 47 L129 70 L123 47 Q109 38 91 40 L78 48 L75 70 Z',
        'M68 70 Q57 40 73 29 Q88 17 104 22 Q133 17 137 47 L134 91 L122 96 L125 54 Q111 48 98 37 Q88 53 77 51 L77 96 L64 91 Z',
        'M68 64 L65 43 L73 44 L71 28 L86 33 L91 17 L103 28 L115 19 L120 33 L133 30 L131 47 L135 56 L127 72 L122 49 L82 45 L74 70 Z'
    ];
    return `<path class="pcard__bust-hair" data-hair-style="${style}" d="${shapes[style]}" fill="${color}" stroke="#17151c" stroke-width="2" stroke-linejoin="round"/>
        <path d="M80 37 Q99 25 119 36" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2.5" stroke-linecap="round"/>`;
}

function playerJerseySvg(player, palette, initials, pose = 'portrait') {
    const team = String(player.team || 'Free agent');
    const clip = `card-shirt-${++cardArtworkSequence}`;
    const posed = pose !== 'portrait';
    const outline = posed
        ? 'M73 108 Q60 110 50 123 L57 153 L52 200 H148 L143 153 L150 123 Q140 110 127 108 Z'
        : 'M24 200 L30 145 Q40 119 72 106 L128 106 Q160 119 170 145 L176 200 Z';
    const stripeTeams = ['Barcelona', 'Milan', 'Inter', 'Juventus', 'Atlético Madrid', 'Porto', 'Fenerbahçe'];
    const white = '#f8fafc';
    let pattern = '';
    if (stripeTeams.includes(team)) {
        pattern = [42, 70, 98, 126, 154].map(x => `<rect x="${x}" y="106" width="14" height="96" fill="${palette.c2}"/>`).join('');
    } else if (team === 'Celtic' || team === 'Flamengo') {
        pattern = [126, 151, 176].map(y => `<rect x="24" y="${y}" width="152" height="12" fill="${palette.c2}"/>`).join('');
    } else if (team === 'River Plate') {
        pattern = `<path d="M135 102 L159 112 L62 202 L36 202 Z" fill="${palette.c2}"/>`;
    } else if (team === 'Boca Juniors') {
        pattern = `<path d="M24 146 H176 V171 H24 Z" fill="${palette.c2}"/>`;
    } else if (team === 'Ajax' || team === 'PSG') {
        pattern = `<path d="M85 106 H115 V200 H85 Z" fill="${team === 'Ajax' ? palette.c1 : palette.c2}"/>
            ${team === 'Ajax' ? `<path d="M24 106 H73 V200 H24 Z M127 106 H176 V200 H127 Z" fill="${white}"/>` : ''}`;
    }
    const whiteSleeves = team === 'Arsenal';
    return `<defs><clipPath id="${clip}"><path d="${outline}"/></clipPath></defs>
        <g class="pcard__jersey" clip-path="url(#${clip})">
            <path class="pcard__bust-body" d="${outline}" fill="${palette.c1}"/>
            ${pattern}
            ${posed ? '' : `<path d="M25 135 L57 115 L68 131 L53 161 L23 151 Z M175 135 L143 115 L132 131 L147 161 L177 151 Z" fill="${whiteSleeves ? white : palette.c2}" opacity="${whiteSleeves ? '1' : '.48'}"/>
            <path d="M31 146 L51 156 M169 146 L149 156" stroke="${white}" stroke-opacity=".85" stroke-width="5"/>
            <path d="M57 122 L47 138 M62 124 L52 140 M143 122 L153 138 M138 124 L148 140" stroke="${white}" stroke-width="2" stroke-opacity=".7"/>`}
            <path class="pcard__bust-shade" d="M100 106 H180 V202 H100 Z" fill="#081221" opacity=".15"/>
            <path d="${posed ? 'M68 144 L62 193 M132 144 L138 193' : 'M65 149 L59 193 M135 149 L141 193'}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>
            <path d="M57 147 L64 157 M143 147 L136 157" stroke="#091324" stroke-opacity=".2" stroke-width="2"/>
        </g>
        <path class="pcard__bust-collar" d="M77 107 L87 119 L100 125 L113 119 L123 107" fill="none" stroke="${palette.c2}" stroke-width="9"/>
        <path d="M78 107 L88 116 L100 122 L112 116 L122 107" fill="none" stroke="${white}" stroke-width="2.5"/>
        <g class="pcard__shirt-crest" transform="translate(123 127)">
            <path d="M0 0 L10 -3 L20 0 V12 Q19 20 10 24 Q1 20 0 12 Z" fill="#101c30" stroke="#f1d282" stroke-width="1.8"/>
            <path d="M3 3 L10 1 L17 3 V11 H3 Z" fill="${palette.c1}"/>
            <path d="M3 12 H17 Q16 18 10 21 Q4 18 3 12" fill="${palette.c2}"/>
            <text x="10" y="14" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="7.5" font-weight="900" stroke="#0c1729" stroke-width=".5" paint-order="stroke">${cardEscape(clubAbbr(team))}</text>
            <path d="M10 -9 L11.4 -6.5 L14 -6 L12 -4 L12.5 -1.5 L10 -2.7 L7.5 -1.5 L8 -4 L6 -6 L8.6 -6.5 Z" fill="#f1d282"/>
        </g>
        <text class="pcard__kit-mark" x="64" y="142" text-anchor="middle" fill="${white}" font-size="9" font-weight="900" font-style="italic">DB</text>
        <text class="pcard__shirt-number" x="100" y="179" text-anchor="middle" fill="${white}" stroke="#0c1729" stroke-width="1.4" paint-order="stroke" font-size="32" font-weight="900">${playerShirtNumber(player)}</text>
        <text class="pcard__bust-initials" x="100" y="194" text-anchor="middle" fill="${white}" font-size="9" font-weight="800" letter-spacing="2">${cardEscape(initials)}</text>`;
}

function playerExpressionSvg(name, override) {
    const expression = Number.isInteger(override) && override >= 0 && override < 6
        ? override : hashText(`${name || ''}:expression`) % 6;
    const eyes = `<g fill="#faf1e6"><ellipse cx="87" cy="69" rx="6" ry="3.5"/><ellipse cx="113" cy="69" rx="6" ry="3.5"/></g>
        <g fill="#33272b"><circle cx="87" cy="69" r="2.6"/><circle cx="113" cy="69" r="2.6"/></g>
        <g fill="#fff"><circle cx="88" cy="68" r=".8"/><circle cx="114" cy="68" r=".8"/></g>`;
    const faces = [
        { name: 'joyful', brows: 'M80 60 Q86 56 93 60 M107 60 Q114 56 120 60',
            eyes: '<path d="M81 69 Q87 62 93 69 M107 69 Q113 62 119 69" fill="none" stroke="#4b302d" stroke-width="2.8"/>',
            mouth: '<path d="M88 85 Q100 91 112 85 Q109 99 100 99 Q91 99 88 85Z" fill="#713d3d"/><path d="M90 87 Q100 91 110 87 L108 91 Q100 94 92 91Z" fill="#fff4e7"/><path d="M96 97 Q100 92 105 97" fill="#d97b7e"/>' },
        { name: 'smiling', brows: 'M80 61 Q87 58 93 61 M107 61 Q114 58 120 61', eyes,
            mouth: '<path d="M90 87 Q100 96 111 86" fill="none" stroke="#8e5344" stroke-width="2.4"/><path d="M91 87 Q100 91 109 87" fill="none" stroke="#fff2de" stroke-width="2"/>' },
        { name: 'determined', brows: 'M80 60 L94 64 M106 64 L120 60',
            eyes: '<path d="M81 68 L93 71 M107 71 L119 68" fill="none" stroke="#3b2a2a" stroke-width="2.8"/>',
            mouth: '<path d="M91 90 Q100 86 109 90 M94 94 H106" fill="none" stroke="#8d5344" stroke-width="2"/>' },
        { name: 'winking', brows: 'M80 61 Q87 57 94 61 M107 59 Q115 55 121 60',
            eyes: '<ellipse cx="87" cy="69" rx="6" ry="3.5" fill="#faf1e6"/><circle cx="88" cy="69" r="2.6" fill="#33272b"/><circle cx="89" cy="68" r=".8" fill="#fff"/><path d="M107 70 Q113 65 119 70" fill="none" stroke="#4b302d" stroke-width="2.8"/>',
            mouth: '<path d="M90 88 Q102 98 113 84" fill="none" stroke="#8e5344" stroke-width="2.4"/><path d="M109 83 L113 84 L114 88" fill="none" stroke="#ae7155" stroke-width="1.3"/>' },
        { name: 'celebrating', brows: 'M80 58 Q87 53 94 58 M106 58 Q113 53 120 58', eyes,
            mouth: '<ellipse cx="100" cy="90" rx="7" ry="10" fill="#713d3d"/><path d="M95 82 H105 L104 85 H96Z" fill="#fff4e7"/><ellipse cx="100" cy="96" rx="4" ry="2.5" fill="#d97b7e"/>' },
        { name: 'confident', brows: 'M80 61 L94 60 M106 57 Q115 53 121 58', eyes,
            mouth: '<path d="M91 91 Q103 94 112 85" fill="none" stroke="#8e5344" stroke-width="2.5"/><path d="M109 84 Q114 83 115 87" fill="none" stroke="#b57857" stroke-width="1.3"/>' }
    ];
    const face = faces[expression];
    return `<g class="pcard__expression" data-expression="${face.name}" stroke-linecap="round" stroke-linejoin="round">
        <path d="${face.brows}" fill="none" stroke="#4c332e" stroke-width="2.7"/>
        ${face.eyes}
        <path d="M100 70 L97 79 L103 80" fill="none" stroke="#b57857" stroke-width="1.7"/>
        ${expression === 0 || expression === 1 || expression === 3 ? '<g fill="#c66f64" opacity=".23"><ellipse cx="82" cy="80" rx="6" ry="3"/><ellipse cx="118" cy="80" rx="6" ry="3"/></g>' : ''}
        ${face.mouth}
    </g>`;
}

function cardRarityMarkSvg(tier) {
    if (tier === 'gold') return '';
    const star = 'M0 -9 L2.6 -3 L9 -2.8 L4 1.5 L5.5 8 L0 4.5 L-5.5 8 L-4 1.5 L-9 -2.8 L-2.6 -3 Z';
    if (tier === 'invincible') return `<svg class="pcard__rarity-mark" viewBox="0 0 72 34" aria-label="Invincible, three stars">
        <g class="pcard__rarity-stars" fill="#fff1ff" stroke="#ef9dff" stroke-width="1.2">${[14, 36, 58].map((x, i) => `<path transform="translate(${x} ${i === 1 ? 13 : 17})" d="${star}"/>`).join('')}</g></svg>`;
    if (tier === 'goat') return '';
    return `<svg class="pcard__rarity-mark" viewBox="0 0 72 34" aria-label="Elite, diamond insignia">
        <path d="M36 3 L49 15 L36 28 L23 15 Z" fill="#bdefff" stroke="#fff" stroke-width="1.2"/>
        <path d="M16 12 L23 19 M56 12 L49 19 M12 17 L21 26 M60 17 L51 26" stroke="#72d5ff" stroke-width="2" fill="none"/></svg>`;
}

function portraitAuraSvg(tier) {
    if (tier === 'gold') return '';
    const color = tier === 'goat' ? '#ffda75' : tier === 'invincible' ? '#f4a5ff' : '#8fddff';
    const shape = tier === 'invincible'
        ? '<path d="M100 4 L164 43 L164 114 L100 153 L36 114 L36 43 Z"/>'
        : '<circle cx="100" cy="72" r="65"/><circle cx="100" cy="72" r="58" stroke-dasharray="2 8"/>';
    return `<g class="pcard__portrait-aura" fill="none" stroke="${color}" stroke-width="1.4" opacity=".55">${shape}
        <path d="M35 51 L35 63 M29 57 H41 M164 91 V105 M157 98 H171" stroke-width="2"/>
        ${tier === 'goat' ? '<path d="M38 100 Q18 67 40 32 M162 100 Q182 67 160 32 M33 85 L22 75 M31 66 L21 55 M37 46 L29 35 M167 85 L178 75 M169 66 L179 55 M163 46 L171 35" stroke-width="3"/>' : ''}
    </g>`;
}

function portraitHeadwearSvg(tier) {
    if (tier === 'gold') return '';
    if (tier === 'goat') return `<g class="pcard__portrait-crown">
        <path d="M76 31 L71 14 L86 22 L99 6 L113 22 L128 14 L123 31 Z" fill="#edb947" stroke="#fff0b0" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M77 31 H122 V37 H77Z" fill="#a86c23" stroke="#ffd879" stroke-width="1.2"/>
        <path d="M99 17 L103 23 L99 29 L95 23 Z" fill="#fff7db"/>
        <circle cx="81" cy="28" r="2" fill="#fff7db"/><circle cx="117" cy="28" r="2" fill="#fff7db"/>
    </g>`;
    const color = tier === 'invincible' ? '#c55edc' : '#358abc';
    return `<g class="pcard__headband">
        <path d="M73 50 Q100 42 127 50 L126 57 Q100 49 74 57Z" fill="${color}" stroke="${tier === 'invincible' ? '#ffd2ff' : '#c4f4ff'}" stroke-width="1"/>
        <path d="M126 53 L139 60 L131 64 L143 71 L132 69 L122 56Z" fill="${color}"/>
        ${tier === 'invincible' ? '<path d="M100 47 L102 50 L106 50 L103 53 L104 57 L100 55 L96 57 L97 53 L94 50 L98 50Z" fill="#fff0ff"/>' : '<path d="M88 50 L92 53 L96 49" fill="none" stroke="#dbf8ff" stroke-width="1.3"/>'}
    </g>`;
}

function portraitPoseSvg(tier, pose, palette, player) {
    if (tier === 'gold') return '';
    const accent = tier === 'goat' ? '#f4cf75' : tier === 'invincible' ? '#ecb2ff' : '#9bdeff';
    const band = `<g class="pcard__captain-band"><path d="M31 145 L48 151 L45 163 L28 157Z" fill="${accent}"/>
        <text x="37" y="156" text-anchor="middle" fill="#152035" font-size="8" font-weight="900" transform="rotate(18 37 156)">C</text></g>`;
    if (tier === 'elite') return `${band}<path d="M76 108 L87 121 M124 108 L113 121" fill="none" stroke="${accent}" stroke-width="2.5"/>`;
    const sleeve = player && player.team === 'Arsenal' ? '#f8fafc' : palette.c1;
    const leftSleeve = pose === 'fist-up'
        ? 'M70 108 Q54 108 44 120 L34 132 L50 147 L67 132Z'
        : 'M72 108 Q53 109 44 126 L38 143 L55 151 L68 132Z';
    const rightSleeve = pose === 'point-up'
        ? 'M127 108 Q143 108 152 120 L169 134 L154 149 L137 135Z'
        : 'M128 108 Q147 109 156 126 L162 143 L145 151 L132 132Z';
    const sleeves = `<g class="pcard__pose-sleeves" stroke="#152035" stroke-opacity=".25" stroke-width="1">
        <path d="${leftSleeve}" fill="${sleeve}"/><path d="${rightSleeve}" fill="${sleeve}"/>
        <path d="${pose === 'fist-up' ? 'M37 132 L50 144' : 'M40 141 L55 148'}" stroke="${accent}" stroke-width="5"/>
        <path d="${pose === 'point-up' ? 'M166 135 L155 146' : 'M160 141 L145 148'}" stroke="#f8fafc" stroke-width="3"/>
        <path d="M61 116 L51 131 M65 118 L55 133 M139 116 L149 131" stroke="#f8fafc" stroke-opacity=".65" stroke-width="1.8"/>
    </g>`;
    if (pose === 'arms-crossed') return `<g class="pcard__pose-arms" stroke="#aa7253" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M43 142 Q36 159 42 172 Q47 186 60 182 L132 157 Q145 157 144 149 Q138 144 130 150 L58 167 L57 147Z" fill="#c9906c"/>
        <path d="M157 142 Q164 159 158 172 Q153 186 139 181 L71 158 Q59 158 57 151 Q61 144 72 150 L142 167 L143 147Z" fill="#daa27d"/>
        <path d="M117 160 L122 176 M80 160 L75 176" stroke="${accent}" stroke-width="5"/>
        <path d="M65 150 L78 156 M63 154 L75 160 M135 150 L124 154" fill="none" stroke="#b27a59"/>
        <path d="M49 169 Q52 175 58 173 M151 169 Q148 175 142 173" fill="none" stroke="#b27a59"/>
    </g>${sleeves}`;
    if (pose === 'point-up') return `<g class="pcard__pose-arms" stroke="#ab7355" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M42 143 L57 148 L48 200 H30Z" fill="#ce9671"/>
        <path d="M158 134 Q170 138 177 146 L177 100 L191 99 L192 147 Q191 163 179 166 Q169 165 150 148Z" fill="#daa27d"/>
        <path d="M177 111 L191 110" stroke="${accent}" stroke-width="6"/>
        <path d="M178 102 L174 88 Q169 82 172 78 Q176 75 181 84 L181 59 Q181 53 185 53 Q189 53 189 59 V81 Q194 77 196 83 L196 95 Q195 101 190 104Z" fill="#daa27d"/>
        <path d="M187 83 L187 92 M192 84 L192 93 M178 148 Q183 152 187 147" fill="none"/>
    </g>${sleeves}`;
    return `<g class="pcard__pose-arms" stroke="#ac7253" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M158 143 L143 148 L152 200 H170Z" fill="#ce9671"/>
        <path d="M43 134 Q35 139 28 146 L23 111 L9 113 L13 150 Q15 164 27 166 Q37 165 54 147Z" fill="#daa27d"/>
        <path d="M10 121 L25 118" stroke="${accent}" stroke-width="6"/>
        <path d="M10 113 L7 101 L8 90 Q10 84 14 87 Q17 81 21 86 Q27 82 30 88 L33 95 L29 107 L23 113Z" fill="#daa27d"/>
        <path d="M13 91 L14 99 M20 89 L21 98 M27 91 L26 100 M17 148 Q22 153 27 148" fill="none"/>
    </g>${sleeves}`;
}

function playerBustSvg(player, palette, initials, tier = cardTierOf(player)) {
    const pose = tier === 'goat' ? (hashText(`${player.name}:pose`) % 2 ? 'point-up' : 'arms-crossed')
        : tier === 'invincible' ? 'fist-up' : 'portrait';
    const expression = tier === 'goat' ? (pose === 'arms-crossed' ? 2 : 5) : undefined;
    return `
        <svg class="pcard__bust" data-portrait-tier="${tier}" data-pose="${pose}" viewBox="0 0 200 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
            <ellipse class="pcard__bust-shadow" cx="100" cy="194" rx="72" ry="8"></ellipse>
            ${portraitAuraSvg(tier)}
            ${playerJerseySvg(player, palette, initials, pose)}
            ${portraitPoseSvg(tier, pose, palette, player)}
            <path d="M89 87 H111 V108 L100 117 L89 108 Z" fill="#be825e"/>
            <path d="M89 88 H111 V98 Q99 107 89 99 Z" fill="#6b3d30" opacity=".3"/>
            <ellipse cx="70" cy="68" rx="5" ry="9" fill="#ce9671"/>
            <ellipse cx="130" cy="68" rx="5" ry="9" fill="#ce9671"/>
            <path class="pcard__bust-head" d="M72 52 Q72 30 100 30 Q128 30 128 52 L125 80 Q120 96 100 101 Q80 96 75 80 Z" fill="#daa27d" stroke="#b77c59" stroke-width="1.5"/>
            <path d="M100 37 Q127 36 127 59 L124 80 Q117 94 100 99 Z" fill="#a96d50" opacity=".2"/>
            ${playerHairSvg(player.name)}
            ${portraitHeadwearSvg(tier)}
            ${playerExpressionSvg(player.name, expression)}
        </svg>`;
}

function renderPlayerCard(player, opts = {}) {
    if (!player) return '';
    const tier = opts.tier || cardTierOf(player);
    const size = opts.size || 'md';
    const rating = cardRatingOf(player);
    const pos = player.mainPos || 'CM';
    const isGK = pos === 'GK';
    const stats = player.stats || {};
    const palette = teamPalette(player.team || player.name);
    const initials = playerInitials(player.name);
    const name = String(player.name || 'Unknown');
    const nameClass = name.length > 21 ? 'pcard__name--xlong' : (name.length > 15 ? 'pcard__name--long' : '');
    const tierMeta = CARD_TIER_META[tier] || CARD_TIER_META.gold;
    const year = opts.year || new Date().getFullYear();

    const statKeys = isGK
        ? [['DRI', 'PAS', 'SHO'], ['DEF', 'PAC', 'PHY']]
        : [['PAC', 'SHO', 'PAS'], ['DRI', 'DEF', 'PHY']];

    const statsHtml = opts.showStats === false ? '' : `
        <div class="pcard__stats">
            ${statKeys.map(column => `
                <div class="pcard__stat-col">
                    ${column.map(key => `
                        <div class="pcard__stat">
                            <span>${cardEscape(statLabel(key, isGK))}</span>
                            <b>${Number.isFinite(Number(stats[key])) ? Math.round(stats[key]) : '—'}</b>
                        </div>`).join('')}
                </div>`).join('')}
        </div>`;

    const clickAttr = opts.onclick ? ` onclick="${opts.onclick}"` : '';
    const badge = opts.badge ? `<span class="pcard__badge">${cardEscape(opts.badge)}</span>` : '';
    const extra = opts.className ? ` ${opts.className}` : '';

    return `
        <div class="pcard pcard--${size} pcard--${tier}${isGK ? ' pcard--gk' : ''}${opts.selected ? ' is-selected' : ''}${opts.dim ? ' is-dim' : ''}${extra}"
             data-tier="${tier}" data-player-id="${player.id}"${clickAttr}>
            <div class="pcard__frame">
                <div class="pcard__inner">
                    <div class="pcard__bg"></div>
                    <div class="pcard__pattern"></div>
                    <div class="pcard__holo"></div>
                    <div class="pcard__shine"></div>
                    ${cardRarityMarkSvg(tier)}
                    <div class="pcard__top">
                        <div class="pcard__rating">
                            <span class="pcard__ovr">${rating}</span>
                            <span class="pcard__pos">${cardEscape(pos)}</span>
                        </div>
                    </div>
                    <div class="pcard__meta">
                        ${countryFlagMarkup(player.nationality)}
                        <span class="pcard__club" style="--club-a:${palette.c1};--club-b:${palette.c2}" title="${cardEscape(player.team || 'Free agent')}">${cardEscape(clubAbbr(player.team))}</span>
                    </div>
                    <div class="pcard__portrait">
                        <span class="pcard__halo"></span>
                        ${playerBustSvg(player, palette, initials, tier)}
                    </div>
                    <div class="pcard__name ${nameClass}"><span>${cardEscape(name)}</span></div>
                    ${statsHtml}
                    <div class="pcard__foot">
                        <span class="pcard__tier">${tierMeta.label}</span>
                        <span class="pcard__year">${year}</span>
                    </div>
                    ${badge}
                </div>
            </div>
        </div>`;
}

function renderSquadRow(player, opts = {}) {
    if (!player) return '';
    const tier = cardTierOf(player);
    const price = opts.price;
    const click = opts.managerId != null ? ` onclick="openPlayerCard(${player.id}, ${opts.managerId})"` : '';
    return `
        <li class="squad-row squad-row--${tier}"${click} tabindex="0"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPlayerCard(${player.id}, ${opts.managerId != null ? opts.managerId : 'null'})}">
            <span class="squad-row__badge">
                <b>${cardRatingOf(player)}</b>
                <i>${cardEscape(player.mainPos || '')}</i>
            </span>
            <span class="squad-row__body">
                <b>${cardEscape(player.name)}</b>
                <small>${cardEscape(cardPositions(player))}${player.team ? ` · ${cardEscape(player.team)}` : ''}</small>
            </span>
            ${price != null ? `<span class="squad-row__price">€${price}M</span>` : ''}
        </li>`;
}

function countEmptyFormationSlots(manager, player) {
    if (!manager || !player) return 0;
    const positions = new Set([player.mainPos, ...(Array.isArray(player.subPos) ? player.subPos : [])].filter(Boolean));
    return (manager.formation || []).filter(node => !node.assignedPlayerId && positions.has(node.pos)).length;
}

function nationLinkInfo(manager, player) {
    if (!manager || !player) return null;
    const starters = typeof getFormationPlayers === 'function' ? getFormationPlayers(manager) : [];
    const key = typeof chemistryKeyOf === 'function' ? chemistryKeyOf(player) : String(player.nationality || '').toLowerCase();
    const same = starters.filter(starter => starter.id !== player.id
        && (typeof chemistryKeyOf === 'function' ? chemistryKeyOf(starter) : String(starter.nationality || '').toLowerCase()) === key).length;
    const next = same + 1;
    const bonus = next >= CHEMISTRY.STRONG_MIN ? CHEMISTRY.STRONG_BONUS
        : next >= CHEMISTRY.WARM_MIN ? CHEMISTRY.WARM_BONUS : 0;
    return { same, next, bonus };
}

function shortManagerName(name) {
    return String(name || '?').trim().split(/\s+/)[0].slice(0, 9);
}

function renderScoutStrip(player, managerId) {
    if (!player || typeof gameState === 'undefined') return '';
    const managers = managerId != null
        ? gameState.managers.filter(manager => manager.id === managerId)
        : gameState.managers;
    if (!managers.length) return '';
    const fit = managers.map(manager => `
        <span class="scout-team">
            <b>${cardEscape(shortManagerName(manager.name))}</b>
            <em>${countEmptyFormationSlots(manager, player)} ${cardEscape(player.mainPos || '')}</em>
        </span>`).join('');
    const focus = managers[0];
    const link = nationLinkInfo(focus, player);
    const tier = cardTierOf(player);
    return `
        <div class="scout-strip">
            <div class="scout-chip scout-chip--fit">
                <span>Fits XI</span>
                <div class="scout-teams">${fit}</div>
            </div>
            ${link ? `
                <div class="scout-chip">
                    <span>Nation link</span>
                    <b>${cardEscape(player.nationality || 'World')} ×${link.next}${link.bonus ? ` <em>+${link.bonus}</em>` : ''}</b>
                </div>` : ''}
            <div class="scout-chip">
                <span>Tier</span>
                <b class="scout-tier scout-tier--${tier}">${CARD_TIER_META[tier].label}</b>
            </div>
        </div>`;
}

// --- Card detail modal ----------------------------------------------------

let cardModalCloseTimer = null;

function openPlayerCard(playerId, managerId) {
    if (typeof gameState === 'undefined') return;
    const id = Number(playerId);
    let player = null;
    let manager = null;

    if (managerId != null) {
        manager = gameState.managers.find(item => item.id === Number(managerId)) || null;
        if (manager) player = (manager.squad || []).find(item => item.id === id) || null;
    }
    if (!player) {
        player = (typeof availablePlayers !== 'undefined' ? availablePlayers : []).find(item => item.id === id) || null;
    }
    if (!player) {
        for (const candidate of gameState.managers) {
            const found = (candidate.squad || []).find(item => item.id === id);
            if (found) { player = found; manager = candidate; break; }
        }
    }
    if (!player) return;

    const card = document.getElementById('card-modal-card');
    const nameEl = document.getElementById('card-modal-name');
    const subEl = document.getElementById('card-modal-sub');
    const tagsEl = document.getElementById('card-modal-tags');
    const rowsEl = document.getElementById('card-modal-rows');
    const modal = document.getElementById('card-modal');
    if (!card || !modal) return;

    const tier = cardTierOf(player);
    const inXI = manager ? (manager.formation || []).find(node => node.assignedPlayerId === player.id) : null;
    const link = manager ? nationLinkInfo(manager, player) : null;
    const rows = [
        ['Club', player.team || 'Free agent'],
        ['Nation', player.nationality || 'World'],
        ['Position', cardPositions(player) || '—'],
        ['Overall', `${cardRatingOf(player)}${player.rank ? ` · ${player.rank}` : ''}`],
        ['In XI', inXI ? `Yes · ${inXI.pos}` : 'No'],
        ['Chemistry', link ? `${link.next} ${player.nationality || 'World'}${link.bonus ? ` · +${link.bonus}` : ''}` : '—'],
        ['Price', player.price != null ? `€${player.price}M` : '—']
    ];

    card.innerHTML = renderPlayerCard(player, { size: 'xl', showStats: true });
    if (nameEl) nameEl.textContent = player.name || 'Unknown';
    if (subEl) subEl.textContent = `${player.team || 'Free agent'} · ${player.nationality || 'World'}`;
    if (tagsEl) {
        tagsEl.innerHTML = `
            <span class="card-tag card-tag--${tier}">${CARD_TIER_META[tier].label}</span>
            <span class="card-tag">${cardEscape(player.mainPos || 'CM')}</span>
            ${player.rank ? `<span class="card-tag">${cardEscape(player.rank)}</span>` : ''}`;
    }
    if (rowsEl) {
        rowsEl.innerHTML = rows.map(([label, value]) => `
            <div class="card-info-row">
                <span>${cardEscape(label)}</span>
                <b>${cardEscape(value)}</b>
            </div>`).join('');
    }

    clearTimeout(cardModalCloseTimer);
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('is-open'));
}

function closePlayerCard() {
    const modal = document.getElementById('card-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    clearTimeout(cardModalCloseTimer);
    cardModalCloseTimer = setTimeout(() => modal.classList.add('hidden'), 180);
}
