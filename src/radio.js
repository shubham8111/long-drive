import { asset, STATIC } from './paths.js';
// Long Drive Radio: music with a soft-spoken announcer between songs. Two sources:
//   'local'    songs from /music/index.json (see public/music/README.md), played with an <audio> element: no video,
//              no network, no YouTube script
//   'youtube'  the YouTube IFrame Player API (the stations below, "My Station")
// radio.setSource('local' | 'youtube') switches; it is remembered. The announcer is a local neural voice served by the dev/preview
// server at /tts (see scripts/tts.mjs); the browser's speechSynthesis is the fallback when it is unavailable.

export const STATIONS = [
  {
    id: 'open-road',
    name: 'Open Road',
    tagline: 'classic songs for the long highway',
    tracks: [
      { id: '1vrEljMfXYo', title: 'Take Me Home, Country Roads', artist: 'John Denver' },
      { id: '1lWJXDG2i0A', title: "Free Fallin'", artist: 'Tom Petty' },
      { id: 'mrZRURcb1cM', title: 'Dreams', artist: 'Fleetwood Mac' },
      { id: 'zSAJ0l4OBHM', title: 'A Horse with No Name', artist: 'America' },
      { id: 'FTQbiNvZqaY', title: 'Africa', artist: 'Toto' },
      { id: 'V1bFr2SWP1I', title: 'Somewhere Over the Rainbow', artist: 'Israel Kamakawiwoʻole' },
    ],
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    tagline: 'warm indie and folk for the light before dusk',
    tracks: [
      { id: 'TWcyIpul8OE', title: 'Holocene', artist: 'Bon Iver' },
      { id: 'KtlgYxa6BMU', title: 'The Night We Met', artist: 'Lord Huron' },
      { id: 'uJ_1HMAGb4k', title: 'Riptide', artist: 'Vance Joy' },
      { id: 'zvCBSSwgtg4', title: 'Ho Hey', artist: 'The Lumineers' },
      { id: 'RBumgq5yVrA', title: 'Let Her Go', artist: 'Passenger' },
      { id: 'yKNxeF4KMsY', title: 'Yellow', artist: 'Coldplay' },
      { id: 'ghb6eDopW8I', title: 'Little Talks', artist: 'Of Monsters and Men' },
    ],
  },
  {
    id: 'still-water',
    name: 'Still Water',
    tagline: 'quiet piano and ambient music for slow miles',
    tracks: [
      { id: 'UfcAVejslrU', title: 'Weightless', artist: 'Marconi Union' },
      { id: '4VR-6AS0-l4', title: 'Nuvole Bianche', artist: 'Ludovico Einaudi' },
      { id: 'CvFH_6DNRCY', title: 'Clair de Lune', artist: 'Debussy' },
      { id: '7maJOI3QMu0', title: 'River Flows in You', artist: 'Yiruma' },
      { id: 'S-Xm7s9eGxU', title: 'Gymnopédie No. 1', artist: 'Erik Satie' },
      { id: 'NvryolGa19A', title: "Comptine d'un autre été", artist: 'Yann Tiersen' },
      { id: '_VONMkKkdf4', title: 'Experience', artist: 'Ludovico Einaudi' },
    ],
  },
  {
    id: 'mine',
    name: 'My Station',
    tagline: 'songs you picked yourself',
    tracks: [],
  },
];

// The local library as a station (not in STATIONS, so station pickers do not list it); its tracks are
// filled in from /music/index.json by Radio._loadLocal(). `intro` is said after the ident when the radio starts.
export const LOCAL_STATION = {
  id: 'local',
  name: 'Long Drive Radio',
  tagline: 'slow music for the long way home',
  intro: 'Slow music for the long way home.',
  tracks: [],
};
// the sentence that follows the ident when the radio is switched on
export function stationIntro(st) {
  return st.intro || `This is ${st.name}, ${st.tagline}.`;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const QUOTES = [
  'The road does not hurry, and somehow everyone still arrives.',
  'Some of the best thinking happens while looking at nothing in particular.',
  'There is a quiet kind of wealth in an empty afternoon.',
  'Home is less a place than a direction you keep leaning toward.',
  'A long drive is a good way to let a tangled thought finally come loose.',
  'Patience is just attention that has learned to relax.',
  'The light on a late road is a small gift, so notice it.',
  'Not every mile needs a reason. Some are simply for the going.',
  'A good friend is someone you can sit beside in silence and still feel accompanied.',
  'Slow down enough and the world begins to show you its details.',
  'The horizon never gets closer, and yet the scenery changes beautifully.',
  'It is a fine thing to be exactly where you are, with nowhere you must be.',
  'A warm cup, an open window, and a little time. That is nearly everything.',
  'Today is made of ordinary moments, and the ordinary ones are often the dearest.',
  'The miles will pass either way, so you may as well enjoy them.',
  'Listen closely, and even the quiet has a melody.',
  'Gratitude is easiest to find on a road with no traffic.',
  'There is no wrong speed for a thoughtful mind.',
  'Every small town has a porch light left on for someone.',
  'Kindness costs very little, and it travels remarkably far.',
  'The sky does its best work when nobody is asking it to.',
  'Rest is not the opposite of progress. It is part of the journey.',
  'Memory tends to keep the gentle moments and let the hurried ones go.',
  'A road is just a long invitation, and you already said yes.',
  'Some days the best plan is to keep the wheels turning and the heart open.',
  'Letting go feels a lot like the landscape sliding past the window.',
  'The older I get, the more I love a simple view and a simple song.',
  'There is a deep comfort in being carried along.',
  'Let your shoulders drop. The road has this part handled.',
  'Wherever you are headed, you have already brought the best of yourself along.',
  'The smallest joys are the ones that fit in your pocket and last the longest.',
  'A song at the right moment can feel like an old friend knocking at the door.',
  'Clouds teach us how to move without any struggle.',
  'Take the long way when you can. It is usually the kinder one.',
  'The evening arrives gently, if you let it.',
  'Wide open space has a way of making a heart feel roomy too.',
  'You do not have to solve everything before the next bend in the road.',
  'A quiet morning is a promise that the day will go easy on you.',
  'Often the destination is only an excuse for the journey.',
  'Trust the pace you are on. It has carried you this far.',
  'Look up now and then. The sky keeps good company.',
  'Sharing a road with a friend makes every mile a little shorter and a little sweeter.',
  'Warm light through a dusty windshield is its own kind of painting.',
  'Time feels longer when you are hurrying and kinder when you are not.',
  'A deep breath is a very small vacation, and it is always available.',
  'The fields keep their own calendar, and they never seem to worry.',
  'Home will be there when you arrive, and so will the person you are becoming.',
  'There is grace in the gap between one place and the next.',
  'If you are tired, rest. The road will wait, and so will the view.',
  'A little wonder, taken daily, does a person a world of good.',
  'The hum of the tires is a lullaby for a restless mind.',
  'Some roads you travel, and some roads travel you.',
  'A cool breeze, a favorite song, and a mind at ease. What more could the day offer?',
  'Gentle things last. Soft rain wears down mountains, after all.',
  'Everything you need to notice is passing by at a perfectly fair speed.',
  'The best conversations often begin after a long, comfortable quiet.',
  'Stars do not rush, and they have never missed a night.',
  'The world is mostly made of ordinary kindness, if you watch long enough.',
  'Bring along a little curiosity, and every bend becomes a surprise.',
  'It is all right to be unfinished. The road is, too.',
  'May your tank be full, your windows low, and your worries light.',
  'Out here, even the silence has good manners.',
  'There is always a bit more daylight than you think.',
  'A steady heart makes for a smooth road.',
  'Somewhere ahead, someone is glad you are coming.',
  'The best view is often the one you were not looking for.',
  // added 2026-11-13
  'Nobody ever looked back on a drive and wished they had hurried more.',
  'A full moon over an empty road is the kind of company that asks for nothing.',
  'You are allowed to enjoy something without making it useful.',
  'The radio, the road, and a little dusk. Some evenings write themselves.',
  'Cities sound different at night, like they finally have time to think.',
  'Rain on the roof is the oldest song there is, and it still works.',
  'Every street you pass is somebody\'s whole world. Wave if you like.',
  'Being lost for a while is just a slower way of being found.',
  'Most worries are smaller than they look in the rear-view mirror.',
  'A good song can make a familiar road feel brand new.',
  'There is a version of today that only exists because you took this road.',
  'The trees have been standing here all along, waiting for someone to notice.',
  'You can carry a lot of weight, but you do not have to carry it all at once.',
  'Some of the kindest people you will ever meet are the ones you only see for a moment.',
  'Even the longest night is just the road between two sunsets.',
  'The world is wide, and you are allowed to take up a little room in it.',
  'Breathe in what is in front of you. Breathe out what is behind you.',
  'A slow afternoon is a small act of rebellion. Enjoy it.',
  'Snow makes every place feel like it is keeping a secret, kindly.',
  'Fog does not hide the world. It just asks you to look closer.',
  'The heart keeps its own map, and it is never wrong about home.',
  'Turn the music up a little, and let the miles do the talking.',
  'There is nothing to fix right now. Just this road, and this song.',
  'A lit window at night is a quiet reminder that someone is doing all right.',
  'The good old days are being made right now. This could be one of them.',
  'Kindness to yourself counts too. Maybe it counts most.',
  'Somewhere a kettle is on, a dog is asleep, and all is well.',
  'Distance is just time with a view.',
  'Let the road be long. You have nowhere better to be than here.',
  'Every sunset is the sky saying, well done, you made it through another one.',
  // a few old voices, worth hearing again
  'As John Muir wrote, in every walk with nature one receives far more than he seeks.',
  'Ralph Waldo Emerson put it simply: adopt the pace of nature. Her secret is patience.',
  'Robert Louis Stevenson said he travelled not to go anywhere, but to go. The great affair is to move.',
  'Walt Whitman, setting out: afoot and light-hearted I take to the open road, healthy, free, the world before me.',
  'Henry David Thoreau reminds us that heaven is under our feet as well as over our heads.',
  'Emily Dickinson wrote that hope is the thing with feathers that perches in the soul.',
  // added 2026-11-14
  'Breathe in for the road ahead, breathe out for the road behind.',
  'Nothing out here needs an answer from you tonight.',
  'The mountains have never once been in a hurry, and look how well they turned out.',
  'Let your shoulders drop an inch. The road can carry the rest.',
  'Somewhere a kettle is just starting to sing. That is a good thought to hold.',
  'You are allowed to enjoy this without earning it first.',
  'The clouds keep changing their minds, and the sky never minds at all.',
  'A good road is like a good friend. It does not need you to talk.',
  'There is no wrong speed for watching the world go by.',
  'The day you had is behind you now. Let it ride in the back seat, quietly.',
  'Every tree you pass has weathered a few storms and kept its leaves for the spring.',
  'Soft light, open road, nowhere to be. Hold on to that for a minute.',
  'The horizon is always the same distance away, which means you can stop chasing it.',
  'Rest is not the opposite of progress. It is how progress keeps going.',
  'Even the river takes the long way round, and it always reaches the sea.',
  'Listen. Under the music, the world is humming along just fine.',
  'Some thoughts are like passing towns. You can wave and keep going.',
  'You do not have to fill the quiet. The quiet is doing fine on its own.',
  'Out here, the only schedule is the sun, and it is very forgiving.',
  'A long drive is a kind of meditation with better scenery.',
  'Whatever you are carrying, it is lighter at forty miles an hour.',
  'The stars come out whether we watch or not. Tonight, why not watch.',
  'There is a version of you that is already at peace. Let them drive for a while.',
  'Every bend in the road is a small surprise you did not have to plan.',
  'The wind does not ask where it is going. It just goes, and it is never lost.',
  'Good things grow slowly. So do good days.',
  'Let the road straighten out your thoughts the way it straightens out the miles.',
  'You have come a long way. Not just tonight.',
  'A field of grass in the evening light is proof that simple things can be beautiful.',
  'There is no traffic on the road to feeling better. Take your time.',
  'Somewhere ahead, a porch light, a warm bed, and a quiet morning. No rush.',
  'The night sky is the oldest map there is, and it still says you are here, and that is enough.',
  'The rain will pass. It always does. Until then, it sounds lovely.',
  'Notice your hands on the wheel. Loosen them a little. There you go.',
  'The best views are the ones you were not expecting.',
  'Mile by mile, the world keeps showing up for you.',
  'Patience is just hope that has learned to sit still.',
  'Let the hum of the road be the only thing you listen to for a moment.',
  'Even the tallest pine started as something small that waited.',
  'The sky does not count its clouds. It just lets them drift.',
  'Kindness to yourself is a good habit to pack for every trip.',
  'A quiet road at dusk is one of the world\'s great unadvertised pleasures.',
  'You do not need to know the whole way. Just the next little stretch.',
  'Slow is smooth, and smooth is lovely.',
  'The moon has been keeping watch over travellers for a very long time. It is good at it.',
  'This moment is not on the way to something else. It is the something.',
  'Every road was once just a path someone walked because they were curious.',
  'Fresh air, open windows, and a song you half remember. That is a fine evening.',
  'Leave a little room in the day for nothing at all.',
  'The light changes every minute out here. You never see the same sky twice.',
  'Worry is a passenger. You do not have to let it choose the music.',
  'There is a kind of rest that only comes from watching the world move gently by.',
  'Hills rise and fall, and so do days. Both are worth the view from the top.',
  'You can put the big questions down for now. They will keep.',
  'Small towns, long fences, wide skies. The world is bigger and kinder than the news.',
  'A deep breath is free, and it works every single time.',
  'Somewhere a bird is singing its last song of the day, just because it can.',
  'Every mile you drive tonight is a mile of peace you did not have this morning.',
  'Some of the best conversations are with the window and the wind.',
  'The road ahead is clear enough. That is all a road needs to be.',
  'Gentle is a strength, too.',
  'The trees along the road have been waving at travellers for a hundred years.',
  'When the sky turns gold, it is a good time to forgive yourself for something.',
  'You do not have to be anywhere but here, and here is lovely.',
  'Night driving has a way of making the whole world feel like a secret you are in on.',
  'Water finds its way around every stone. You will find yours, too.',
  'A soft song, a long road, and a quiet mind. Some evenings are just right.',
  'Let the music hold you up for a while. That is what it is for.',
  'The sun will rise tomorrow without any help from you. Rest easy.',
  'Look how far the light travels to reach the road in front of you.',
  'The world is full of people quietly doing their best. You are one of them.',
  'A day that ends gently is a day well spent.',
  'Out here, even the silence has a little warmth in it.',
  'Clouds are just the sky daydreaming.',
  'Let the miles do the thinking for a while.',
  'The ground under the road has been patient for millions of years. A few more minutes is nothing.',
  'You can always pull over, look up, and start again.',
  'Not every road needs a destination. Some are just for the ride.',
  'Your breath is always with you, like a friend who never needs directions.',
  'The evening air has a way of saying, that is enough for today.',
  'Somewhere a window is open and someone is listening to this same quiet.',
  'Easy does it. The best things on this road are not going anywhere.',
  'The mist will lift when it is ready. So will most things.',
  'There is beauty in an ordinary stretch of road, if you let there be.',
  'Your heart keeps a steady beat without being asked. Thank it, now and then.',
  'Every star you can see tonight has travelled a very long way to say hello.',
  'Snow falls without a sound, and somehow the whole world listens.',
  'A long, straight road is a fine place to let a thought finish itself.',
  'The best journeys are measured in moments, not miles.',
  'Morning always finds its way back. You do not have to wait up for it.',
  'Let the hard edges of the day blur a little, like the trees going by.',
  'Somewhere, right now, someone is smiling at the same sunset.',
  'Kind roads, soft music, and nowhere you must be. Enjoy the luxury.',
  'The road remembers everyone who ever drove it gently.',
  'Some evenings, the most important thing to do is nothing in particular.',
  'Every season has its own light. This one is yours.',
  'Even a city sleeps eventually, and it wakes up just fine.',
  'You are not behind. You are exactly on your own road.',
  'The rain makes everything smell new again. Maybe that is the point.',
  'If you notice one beautiful thing on this drive, the drive was worth it.',
  'A quiet mind is not an empty one. It just has room to breathe.',
  'The world spins at a thousand miles an hour, and still the evening feels slow. What a gift.',
  'There is always another song, another mile, another chance.',
  'Let this be the easy part of the day.',
  'Rolling hills, rolling thoughts. Let them both go by.',
  'The headlights only show a little of the road, and that has always been enough.',
  'Nobody is asking anything of you right now. Enjoy that.',
  'Steady hands, soft eyes, and an open road. That is a good way to be.',
  'Somewhere far ahead, the road bends toward home. No hurry getting there.',
  'You have time. You have always had more time than you think.',
];

// Approximate tempo of each built-in song (beats a minute). The browser cannot listen to YouTube's
// audio, so lights that move with the music follow this instead of the sound itself.
const BPM = {
  '1vrEljMfXYo': 82, '1lWJXDG2i0A': 84, mrZRURcb1cM: 120, zSAJ0l4OBHM: 123, FTQbiNvZqaY: 93, V1bFr2SWP1I: 86,
  TWcyIpul8OE: 74, KtlgYxa6BMU: 87, uJ_1HMAGb4k: 102, zvCBSSwgtg4: 80, RBumgq5yVrA: 75, yKNxeF4KMsY: 87, ghb6eDopW8I: 103,
  UfcAVejslrU: 60, '4VR-6AS0-l4': 68, CvFH_6DNRCY: 66, '7maJOI3QMu0': 68, 'S-Xm7s9eGxU': 72, NvryolGa19A: 96, _VONMkKkdf4: 92,
};
const STATION_BPM = { 'open-road': 104, 'golden-hour': 92, 'still-water': 70, mine: 100, local: 80 };

export const IDENTS = [
  "You're riding along with Long Drive Radio.",
  'This is Long Drive Radio, keeping you company on the open road.',
  "You're tuned in to Long Drive Radio.",
  'Long Drive Radio, music for the miles in between.',
  'Welcome back to Long Drive Radio.',
  'Long Drive Radio, with you every mile of the way.',
];

// now and then, between the weather and the song
export const EXTRAS = [
  'This next one goes out to whoever is still awake and still driving.',
  'A listener wrote in to say the best part of any trip is the part with nothing in it. We agree.',
  'Somebody called to ask where this road goes. It goes on. That is the whole answer.',
  'If you are listening with the windows down, good. That is how this station is meant to be heard.',
  'No traffic report tonight. There is no traffic. There is just you.',
  'A dedication now, from the passenger seat to the driver: thank you for not being in a hurry.',
  'We had a request for something slow. Everything here is slow. Request granted.',
  'To the one who took the long way on purpose: this one is yours.',
];

export const UPNEXT = [
  (t, a) => `Up next, ${t}${a ? ' by ' + a : ''}.`,
  (t, a) => `Here is ${t}${a ? ', by ' + a : ''}.`,
  (t, a) => `Coming up, ${t}${a ? ' from ' + a : ''}.`,
  (t, a) => `Let's listen to ${t}${a ? ' by ' + a : ''}.`,
  (t, a) => `Next, ${t}${a ? ' by ' + a : ''}.`,
];

export const HOUR_WORDS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];

function hourWord(h24) {
  return HOUR_WORDS[((Math.round(h24) % 12) + 12) % 12];
}

function periodOf(h24) {
  const h = ((h24 % 24) + 24) % 24;
  if (h < 12) return 'in the morning';
  if (h < 17) return 'in the afternoon';
  if (h < 21) return 'in the evening';
  return 'at night';
}

// Natural spoken phrase for a time of day. hours: 0..24 float.
export function timePhrase(hours) {
  let h = Number(hours);
  if (!isFinite(h)) h = 12;
  h = ((h % 24) + 24) % 24;
  if (h < 4.5) return 'the middle of the night';
  if (h < 5.75) return 'the quiet hour before dawn';
  if (h < 6.5) return 'just before sunrise';

  let hr = Math.floor(h);
  let r = Math.round((h - hr) * 12) * 5; // nearest 5 minutes
  if (r === 60) {
    r = 0;
    hr += 1;
  }
  hr %= 24;
  const next = (hr + 1) % 24;
  const nextWord = next === 0 ? 'midnight' : next === 12 ? 'noon' : hourWord(next);
  const nextBare = next === 0 || next === 12;
  const word = hourWord(hr);
  let clock;
  let per = periodOf(hr);
  switch (r) {
    case 0:
      if (hr === 12) return 'noon';
      if (hr === 0) return 'midnight';
      clock = `${word} o'clock`;
      break;
    case 5:
    case 10:
      clock = `a little after ${word}`;
      break;
    case 15:
      clock = `a quarter past ${word}`;
      break;
    case 20:
      clock = `twenty past ${word}`;
      break;
    case 25:
      clock = `twenty-five past ${word}`;
      break;
    case 30:
      clock = `half past ${word}`;
      break;
    case 35:
      clock = `twenty-five to ${nextWord}`;
      per = periodOf(next);
      break;
    case 40:
      clock = `twenty to ${nextWord}`;
      per = periodOf(next);
      break;
    case 45:
      clock = `a quarter to ${nextWord}`;
      per = periodOf(next);
      break;
    default:
      clock = `just before ${nextWord}`;
      per = periodOf(next);
      break;
  }
  return nextBare && r >= 35 ? clock : `${clock} ${per}`;
}

// Pure line builders (no DOM; importable from Node, e.g. to pre-render every announcer sentence).
// pick(arr) chooses a template; pass your own to enumerate all of them.
const _pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function timeLine(ctx = {}, pick = _pickRandom) {
  const when = timePhrase(ctx.hours);
  const place = [ctx.place, ctx.region].filter(Boolean).join(', ');
  const weather = ctx.weatherSay ? String(ctx.weatherSay) : '';
  const itIs = `It's ${when}`;
  if (place && weather) {
    return pick([
      `${itIs} near ${place}, with ${weather}.`,
      `${itIs}, and out near ${place} there's ${weather}.`,
      `${itIs} near ${place}, ${weather}.`,
    ]);
  }
  if (place) return `${itIs} near ${place}.`;
  if (weather) return `${itIs}, with ${weather}.`;
  return `${itIs}.`;
}
// "Up next, <title> by <artist>." ('' when there is no title)
export function upNextLine(title, artist, pick = _pickRandom) {
  const t = speakable(cleanTitle(title));
  if (!t) return '';
  return pick(UPNEXT)(t, speakable(cleanArtist(artist)));
}
// What the announcer says when the radio is switched on.
export function introLines(station, pick = _pickRandom) {
  return [pick(IDENTS), stationIntro(station)];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LS = {
  get(k) {
    try {
      return window.localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
    } catch (e) { /* ignore */ }
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const NOISE_WORDS =
  'official|music|video|videoclip|lyrics?|lyric video|with lyrics|audio|hd|hq|4k|1080p|remaster(?:ed)?(?: \\d{4})?|visuali[sz]er|mv|full song|full version|official audio|HD audio|clip officiel';
const BRACKETED = new RegExp(`\\s*[\\(\\[\\{][^\\)\\]\\}]*\\b(?:${NOISE_WORDS})\\b[^\\)\\]\\}]*[\\)\\]\\}]`, 'gi');
const PLUS_LYRICS = /\s*[+&]\s*lyrics?\b/gi;
const TRAILING_NOISE = new RegExp(`\\s*[-–|:]\\s*(?:official\\s+)?(?:${NOISE_WORDS})(?:\\s+(?:${NOISE_WORDS}))*\\s*$`, 'gi');
const LOOSE_NOISE = /\s+(?:HD|HQ|4K)\s*$/gi;

export function cleanTitle(s) {
  let t = String(s == null ? '' : s);
  for (let i = 0; i < 2; i++) {
    t = t.replace(BRACKETED, '').replace(PLUS_LYRICS, '').replace(TRAILING_NOISE, '').replace(LOOSE_NOISE, '');
  }
  return t.replace(/\s{2,}/g, ' ').replace(/^[\s\-–|:]+|[\s\-–|:]+$/g, '').trim();
}

function cleanArtist(s) {
  return cleanTitle(String(s || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*Official$/i, ''));
}

// One spoken unit per sentence (also used by scripts/fetch-voice.mjs to pre-render the static lines).
export function splitSentences(text) {
  return (String(text).match(/[^.!?]+[.!?]*/g) || []).map((s) => s.trim()).filter(Boolean);
}

function speakable(s) {
  return String(s || '').replace(/[&]/g, ' and ').replace(/[_*#<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
// "Artist - Title (Official Video)" + channel name -> { title, artist }, tidied for speaking
function splitMeta(rawTitle, rawAuthor) {
  let title = cleanTitle(rawTitle);
  let artist = cleanArtist(rawAuthor);
  const m = title.match(/^(.{1,60}?)\s+[-–]\s+(.+)$/);
  if (m) {
    artist = cleanArtist(m[1]);
    title = cleanTitle(m[2]);
  }
  return { title, artist };
}
const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const thumbOf = (t) => (t && t.id ? (t.file ? '' : thumbUrl(t.id)) : '');

// Parse pasted text into [{ type: 'video'|'playlist', id }]
function parseItems(text) {
  const out = [];
  const tokens = String(text || '').split(/[\s,;]+/).filter(Boolean);
  for (const tok of tokens) {
    let video = null;
    let list = null;
    if (ID_RE.test(tok)) {
      video = tok;
    } else if (/^PL[\w-]{8,}$|^(?:UU|OLAK5uy_|FL|RD)[\w-]{8,}$/.test(tok)) {
      list = tok;
    } else {
      let u = null;
      try {
        u = new URL(/^[a-z]+:\/\//i.test(tok) ? tok : 'https://' + tok);
      } catch (e) {
        u = null;
      }
      if (!u || !/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname)) continue;
      list = u.searchParams.get('list');
      video = u.searchParams.get('v');
      if (!video) {
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
        if (m) video = m[1];
        else if (/youtu\.be$/i.test(u.hostname)) {
          const m2 = u.pathname.match(/^\/([\w-]{11})/);
          if (m2) video = m2[1];
        }
      }
      if (video && !ID_RE.test(video)) video = null;
      // Auto-generated "mix" lists (RD...) can be read like any playlist (cuePlaylist + getPlaylist).
      // Keep the linked video first, so the song that was shared always plays.
      if (list && /^RD/i.test(list) && video) out.push({ type: 'video', id: video });
    }
    if (list) out.push({ type: 'playlist', id: list });
    else if (video) out.push({ type: 'video', id: video });
  }
  return out;
}

// ---------------------------------------------------------------------------
// YouTube API loader (once)
// ---------------------------------------------------------------------------

let ytPromise = null;
function loadYT() {
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    let done = false;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        if (typeof prev === 'function') prev();
      } catch (e) { /* ignore */ }
      done = true;
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      if (done) return;
      ytPromise = null;
      s.remove();
      reject(new Error('YouTube API failed to load'));
    };
    document.head.appendChild(s);
    setTimeout(() => {
      if (!done) {
        ytPromise = null;
        reject(new Error('YouTube API timed out'));
      }
    }, 20000);
  });
  return ytPromise;
}

// ---------------------------------------------------------------------------
// Radio
// ---------------------------------------------------------------------------

const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const FATAL_CODES = new Set([2, 5, 100, 101, 150]);

// The local backend: an <audio> element behind the same small interface the radio uses on the YouTube player
// (loadVideoById, playVideo, pauseVideo, setVolume, getDuration, getCurrentTime, getPlayerState), so the
// fades, the tail, pausing and the break logic are shared. One element, no WebAudio graph: the cheapest
// thing there is (the browser decodes Opus natively).
class LocalPlayer {
  constructor(owner) {
    const a = (this.a = new Audio());
    a.preload = 'auto';
    this.files = new Map(); // track id -> file name
    this.seconds = new Map(); // track id -> length from the index (a streamed .ogg may report an unknown duration)
    this._id = '';
    this._loading = false; // true from loadVideoById until it plays (a `pause` event meanwhile is not the user's)
    this._began = false;
    a.addEventListener('playing', () => { this._loading = false; this._began = true; owner._onPlayerState({ data: 1 }); });
    a.addEventListener('waiting', () => { if (this._began) owner._onPlayerState({ data: 3 }); });
    a.addEventListener('pause', () => { if (!a.ended && !this._loading && a.getAttribute('src')) owner._onPlayerState({ data: 2 }); });
    a.addEventListener('ended', () => owner._onPlayerState({ data: 0 }));
    a.addEventListener('error', () => { if (a.getAttribute('src')) owner._onPlayerError({ data: 100 }); });
  }
  loadVideoById(id) {
    const f = this.files.get(id);
    this._id = id;
    if (!f) throw new Error('unknown local track');
    const a = this.a;
    this._loading = true;
    this._began = false;
    a.src = asset('music/') + f.split('/').map(encodeURIComponent).join('/');
    const pr = a.play();
    if (pr && pr.catch) pr.catch((e) => { if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') a.dispatchEvent(new Event('error')); });
  }
  playVideo() {
    const pr = this.a.play();
    if (pr && pr.catch) pr.catch(() => {});
  }
  pauseVideo() { this.a.pause(); }
  setVolume(v) { this.a.volume = clamp01(v / 100); }
  getDuration() { const d = this.a.duration; return isFinite(d) && d > 0 ? d : this.seconds.get(this._id) || 0; }
  getCurrentTime() { return this.a.currentTime; }
  getPlayerState() {
    const a = this.a;
    if (a.ended) return YT_STATE.ENDED;
    if (!this._began) return YT_STATE.UNSTARTED;
    return a.paused ? YT_STATE.PAUSED : YT_STATE.PLAYING;
  }
  getVideoData() { return null; }
  stop() {
    const a = this.a;
    this._loading = false;
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { /* ignore */ }
  }
}

export class Radio {
  constructor({ mount, ambience, getContext } = {}) {
    this.mount = mount || null;
    this.ambience = ambience || null;
    this.getContext = typeof getContext === 'function' ? getContext : () => ({});
    this.onChange = null;

    this._stations = STATIONS;
    this._mine = STATIONS.find((s) => s.id === 'mine');
    this._playlistCache = new Map();
    this._mineItems = [];

    this._player = null;
    this._playerPromise = null;
    this._started = false;
    this._seq = 0;
    this._state = 'paused';
    this._line = '';
    this._current = null;
    this._lastId = null;
    this._queue = [];
    this._quoteBag = [];
    this._failStreak = 0;
    this._watchdogs = [];
    this._voice = null;
    this._voiceLoaded = false;
    this._audio = null; // <audio> element for the neural announcer voice
    this._clipDone = null;
    this._ttsCache = new Map(); // sentence -> Promise<blob url | null>
    this._ttsDownUntil = 0; // after a failed /tts request, use speechSynthesis until this time
    this._plan = null; // announcer lines prepared while the song is still playing
    this._level = 1; // late-night and wind-down level (setLevel), never saved
    this._quiet = false; // quiet mode: music only, no announcer (setQuiet)
    this._tailTimer = setInterval(() => this._tailTick(), 400); // fades each song out before it ends

    const vol = parseFloat(LS.get('longdrive.volume'));
    this._volume = isFinite(vol) ? clamp01(vol) : 0.7;

    const custom = LS.get('longdrive.custom');
    if (custom) this._applyCustom(custom);

    let stationId = LS.get('longdrive.station');
    let st = this._stations.find((s) => s.id === stationId);
    if (!st || !st.tracks.length) st = this._stations[0];
    this._ytStation = st; // the YouTube station to use when the source is 'youtube'
    // the source: remembered; the default is YouTube
    const savedSrc = LS.get('longdrive.source');
    this._source = savedSrc === 'local' || savedSrc === 'youtube' ? savedSrc : 'youtube';
    this._station = this._source === 'local' ? LOCAL_STATION : st;
    this._lp = null; // LocalPlayer, made on first use
    this._localPromise = null; // the loaded local library

    this._initVoices();
    this._prefetchTimer = setInterval(() => this._prefetchTick(), 2000);
    // Prefetch the API script (no audio, no autoplay involved). Never in local mode: no YouTube at all.
    if (this._source === 'youtube') loadYT().catch(() => {});
  }

  // ---- public API --------------------------------------------------------

  start() {
    if (this._started) {
      if (this._state === 'paused' || this._state === 'error') this.toggle();
      return;
    }
    this._started = true;
    this._primeSpeech();
    const my = ++this._seq;
    this._setState('loading');
    if (this._source === 'youtube') this._ensurePlayer().catch(() => {});
    (async () => {
      try {
        if (!this._quiet) {
          this._amb('radioStatic', 0.9);
          this._amb('duck', 0.85);
          await sleep(500);
          const st = this._station;
          await this._speakLines([`${this._pick(IDENTS)}`, stationIntro(st)], my);
        }
        if (my !== this._seq) return;
        this._amb('duck', 0);
        await this._startStationPlayback(my);
      } catch (e) {
        if (my === this._seq) this._fail();
      }
    })();
  }

  next() {
    if (!this._started) {
      this.start();
      return;
    }
    const my = ++this._seq;
    this._cancelSpeech();
    this._amb('duck', 0);
    this._failStreak = 0;
    this._startStationPlayback(my);
  }

  toggle() {
    if (!this._started) {
      this.start();
      return;
    }
    if (this._state === 'announcer') {
      // Cut the announcer short and go straight to the music.
      this.next();
      return;
    }
    if (this._state === 'error') {
      this._failStreak = 0;
      this.next();
      return;
    }
    const p = this._active();
    if (!p) return;
    try {
      if (this._state === 'paused') {
        p.playVideo();
        this._setState(this._current ? 'loading' : 'paused');
      } else {
        p.pauseVideo();
        this._clearWatchdogs();
        this._setState('paused');
      }
    } catch (e) { /* ignore */ }
  }

  // id 'local' = the local library. A YouTube station while the source is 'local' is only remembered (so the
  // game's start-up call changes nothing); pass explicit = true for a deliberate pick to switch to YouTube.
  setStation(id, explicit = false) {
    if (id === 'local') { this.setSource('local'); return; }
    const st = this._stations.find((s) => s.id === id);
    if (!st) return;
    if (st.id === 'mine' && !st.tracks.length) return;
    if (this._source === 'local') {
      this._ytStation = st;
      LS.set('longdrive.station', st.id);
      if (explicit) this.setSource('youtube');
      return;
    }
    this._ytStation = st;
    const changed = st !== this._station;
    this._station = st;
    LS.set('longdrive.station', st.id);
    this._queue = [];
    this._failStreak = 0;
    if (!this._started) {
      this._emit();
      return;
    }
    if (!changed && this._state !== 'error') {
      this._emit();
      return;
    }
    const my = ++this._seq;
    this._cancelSpeech();
    this._amb('duck', 0);
    this._amb('radioStatic', 1.2);
    this._setState('loading');
    (async () => {
      await sleep(650);
      if (my !== this._seq) return;
      await this._startStationPlayback(my);
    })();
  }

  get source() { return this._source; }

  // 'local' (the songs in /music, no video) or 'youtube'. Remembered. While the radio is on, the other
  // source's song stops and the new one starts (after a moment of static).
  setSource(src) {
    if (src !== 'local' && src !== 'youtube') return;
    const same = src === this._source;
    this._switchSource(src);
    if (same && this._state !== 'error') { this._emit(); return; }
    this._station = src === 'local' ? LOCAL_STATION : this._ytStation;
    this._restart();
  }

  // change the source without starting anything: the other backend is stopped (the YouTube iframe is removed)
  _switchSource(src) {
    LS.set('longdrive.source', src);
    if (src === this._source && !(src === 'local' && this._station !== LOCAL_STATION)) return;
    this._source = src;
    this._queue = [];
    this._failStreak = 0;
    this._plan = null;
    this._clearWatchdogs();
    if (src === 'local') {
      this._station = LOCAL_STATION;
      this._destroyYT();
    } else {
      this._station = this._ytStation;
      if (this._lp) this._lp.stop();
      loadYT().catch(() => {});
    }
    this._current = null;
  }

  _restart() {
    if (!this._started) { this._emit(); return; }
    const my = ++this._seq;
    this._cancelSpeech();
    this._amb('duck', 0);
    this._amb('radioStatic', 1.2);
    this._setState('loading');
    (async () => {
      await sleep(650);
      if (my !== this._seq) return;
      await this._startStationPlayback(my);
    })();
  }

  // the YouTube player and its iframe are gone: nothing of YouTube stays running
  _destroyYT() {
    const p = this._player;
    this._player = null;
    this._playerPromise = null;
    try { if (p) { try { p.stopVideo && p.stopVideo(); } catch (e) { /* ignore */ } p.destroy && p.destroy(); } } catch (e) { /* ignore */ }
    try { if (this.mount) this.mount.replaceChildren(); } catch (e) { /* ignore */ }
  }

  // the local library: fetched once from /music/index.json into LOCAL_STATION.tracks (kept in place)
  _loadLocal() {
    if (this._localPromise) return this._localPromise;
    this._localPromise = (async () => {
      const r = await fetch(asset('music/index.json'), { cache: 'no-cache' });
      if (!r.ok) throw new Error('music index ' + r.status);
      const j = await r.json();
      const tracks = (j.tracks || []).filter((t) => t && t.id && t.file).map((t) => ({
        id: String(t.id), file: String(t.file), title: String(t.title || t.id), artist: String(t.artist || ''), seconds: +t.seconds || 0, local: true,
      }));
      LOCAL_STATION.tracks.length = 0;
      for (const t of tracks) LOCAL_STATION.tracks.push(t);
      const lp = this._localPlayer();
      for (const t of tracks) { lp.files.set(t.id, t.file); lp.seconds.set(t.id, t.seconds); }
      return LOCAL_STATION.tracks;
    })();
    this._localPromise.catch(() => { this._localPromise = null; });
    return this._localPromise;
  }

  _localPlayer() {
    if (!this._lp) { this._lp = new LocalPlayer(this); this._applyVolume(); }
    return this._lp;
  }

  // the player of the song on air
  _active() {
    return this._current && this._current.file ? this._lp : this._player;
  }

  // the local library for display: [{ id, title, artist, seconds }] ([] until loaded; see localReady())
  localTracks() { return LOCAL_STATION.tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, seconds: t.seconds })); }
  localReady() { return this._loadLocal().then(() => this.localTracks(), () => []); }

  // Play a local song (by id; null = shuffle all), then keep shuffling the library, endless; switches the source to 'local'.
  async playLocal(id = null) {
    let tracks;
    try { tracks = await this._loadLocal(); } catch (e) { return false; }
    if (!tracks.length) return false;
    this._switchSource('local');
    this._station = LOCAL_STATION;
    const first = id ? tracks.find((t) => t.id === id) : null;
    const q = shuffle(tracks).filter((t) => t !== first);
    this._queue = first ? [first, ...q] : q;
    this._failStreak = 0;
    this._plan = null;
    if (!this._started) this.start();
    else this._restart();
    this._emit();
    return true;
  }

  setCustom(text) {
    const n = this._applyCustom(text);
    LS.set('longdrive.custom', String(text || ''));
    if (this._station === this._mine) {
      this._queue = [];
      if (!this._mine.tracks.length) {
        this._station = this._stations[0];
        LS.set('longdrive.station', this._station.id);
      }
    }
    this._emit();
    return n;
  }

  setVolume(v) {
    this._volume = clamp01(v);
    LS.set('longdrive.volume', String(this._volume));
    this._applyVolume();
    if (this._audio) this._audio.volume = this._voiceVolume();
  }

  // ---- state / events ----------------------------------------------------

  _setState(state, line) {
    this._state = state;
    this._line = state === 'announcer' && line ? line : '';
    this._emit();
  }

  _emit() {
    if (typeof this.onChange !== 'function') return;
    const t = this._current || {};
    const info = {
      stationId: this._station.id,
      stationName: this._station.name,
      title: t.title || '',
      artist: t.artist || '',
      state: this._state,
      videoId: t.file ? '' : t.id || '',
      thumb: thumbOf(t),
      source: this._source,
    };
    if (this._line) info.line = this._line;
    try {
      this.onChange(info);
    } catch (e) { /* ignore consumer errors */ }
  }

  _amb(fn, arg) {
    try {
      if (this.ambience && typeof this.ambience[fn] === 'function') this.ambience[fn](arg);
    } catch (e) { /* ignore */ }
  }

  _fail() {
    this._clearWatchdogs();
    this._cancelSpeech();
    this._amb('duck', 0);
    this._seq++;
    this._setState('error');
  }

  // ---- custom station ----------------------------------------------------

  _applyCustom(text) {
    const items = parseItems(text);
    this._mineItems = items;
    const tracks = [];
    const seen = new Set();
    for (const it of items) {
      if (it.type === 'video') {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        tracks.push({ id: it.id, title: '', artist: '' });
      } else {
        const cached = this._playlistCache.get(it.id);
        if (cached && cached.length) {
          for (const id of cached) {
            if (seen.has(id)) continue;
            seen.add(id);
            tracks.push({ id, title: '', artist: '' });
          }
        } else {
          tracks.push({ id: null, playlist: it.id, title: 'Playlist', artist: '' });
        }
      }
    }
    // Keep the exported object identity stable for consumers.
    this._mine.tracks.length = 0;
    for (const t of tracks) this._mine.tracks.push(t);
    return items.length;
  }

  // Read the video ids of a playlist or mix through the player (cached). [] when it cannot be read.
  async _readList(listId, my) {
    if (this._playlistCache.has(listId)) return this._playlistCache.get(listId);
    const p = await this._ensurePlayer();
    if (!p) return [];
    let ids = [];
    try {
      p.cuePlaylist({ listType: 'playlist', list: listId });
      for (let i = 0; i < 28; i++) {
        await sleep(300);
        if (my !== this._seq) return [];
        const got = p.getPlaylist && p.getPlaylist();
        if (got && got.length) {
          ids = got.filter((x) => ID_RE.test(x));
          break;
        }
      }
    } catch (e) { /* ignore */ }
    if (/^RD/.test(listId)) { if (ids.length) this._playlistCache.set(listId, ids); } // mixes are not kept for long
    else this._playlistCache.set(listId, ids);
    if (this._playlistCache.size > 40) this._playlistCache.delete(this._playlistCache.keys().next().value);
    return ids;
  }

  async _resolvePlaylists(my) {
    const mine = this._mine;
    if (!mine.tracks.some((t) => !t.id && t.playlist)) return;
    for (const it of this._mineItems) {
      if (it.type !== 'playlist' || this._playlistCache.has(it.id)) continue;
      if (my !== this._seq) return;
      await this._readList(it.id, my);
      if (my !== this._seq) return;
    }
    this._applyCustom(LS.get('longdrive.custom') || this._mineItems.map((i) => i.id).join(' '));
  }

  // ---- queue -------------------------------------------------------------

  _playableTracks() {
    return this._station.tracks.filter((t) => t.id);
  }

  _pickNext() {
    if (this._demoNext) { const t = this._demoNext; this._demoNext = null; return t; }
    if (!this._queue.length) {
      const tracks = this._playableTracks();
      if (!tracks.length) return null;
      let q = shuffle(tracks);
      if (q.length > 1 && q[0].id === this._lastId) {
        const j = 1 + Math.floor(Math.random() * (q.length - 1));
        [q[0], q[j]] = [q[j], q[0]];
      }
      this._queue = q;
    }
    return this._queue.shift();
  }

  async _startStationPlayback(my) {
    this._setState('loading');
    if (this._station === LOCAL_STATION) {
      try { await this._loadLocal(); } catch (e) { if (my === this._seq) this._fail(); return; }
      if (my !== this._seq) return;
    } else if (this._station === this._mine) {
      await this._resolvePlaylists(my);
      if (my !== this._seq) return;
    }
    const track = this._pickNext();
    if (!track) {
      this._fail();
      return;
    }
    await this._playTrack(track, my);
  }

  // ---- player ------------------------------------------------------------

  _ensurePlayer() {
    if (this._playerPromise) return this._playerPromise;
    const prom = (async () => {
      if (!this.mount) throw new Error('no mount');
      const YT = await loadYT();
      const holder = document.createElement('div');
      this.mount.appendChild(holder);
      const vars = { controls: 0, disablekb: 1, playsinline: 1, modestbranding: 1, rel: 0, fs: 0, iv_load_policy: 3 };
      if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
      return await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('player timeout'));
          }
        }, 20000);
        try {
          const player = new YT.Player(holder, {
            width: '100%',
            height: '100%',
            playerVars: vars,
            events: {
              onReady: () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this._player = player;
                try {
                  const f = player.getIframe && player.getIframe();
                  if (f) {
                    f.style.width = '100%';
                    f.style.height = '100%';
                    f.style.border = '0';
                    f.style.display = 'block';
                  }
                } catch (e) { /* ignore */ }
                this._applyVolume();
                resolve(player);
              },
              onStateChange: (e) => this._onPlayerState(e),
              onError: (e) => this._onPlayerError(e),
            },
          });
        } catch (e) {
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      });
    })();
    this._playerPromise = prom.then(
      (p) => p,
      () => {
        this._playerPromise = null;
        return null;
      }
    );
    return this._playerPromise;
  }

  _applyVolume() {
    try {
      const v = this._volume * (this._gain ?? 1) * (this._musicGain ?? 1) * this._level; // temporary fades, never saved
      if (this._player && this._player.setVolume) this._player.setVolume(Math.round(v * 100));
      if (this._lp) this._lp.setVolume(v * 100);
    } catch (e) { /* ignore */ }
  }

  async _playTrack(track, my) {
    const local = !!track.file;
    const p = local ? this._localPlayer() : await this._ensurePlayer();
    if (my !== this._seq) return;
    // one backend at a time
    try { if (local) { if (this._player && this._player.pauseVideo) this._player.pauseVideo(); } else if (this._lp) this._lp.pauseVideo(); } catch (e) { /* ignore */ }
    if (!p) {
      this._fail();
      return;
    }
    this._current = track;
    this._lastId = track.id;
    this._clearWatchdogs();
    this._setState('loading');
    this._tailing = false;
    // every song comes in softly (unless a crossfade is already bringing it up)
    if ((this._musicGain ?? 1) >= 0.999 || (this._musicGain ?? 1) <= 0.001) { this._mfadeId = (this._mfadeId || 0) + 1; this._musicGain = 0; this._fadeInPending = true; }
    try {
      p.loadVideoById(track.id);
      this._applyVolume();
    } catch (e) {
      this._onTrackFailed();
      return;
    }
    const mySeq = my;
    // Autoplay blocked or stuck unstarted: offer a paused state the user can resume.
    this._watchdogs.push(
      setTimeout(() => {
        if (mySeq !== this._seq || this._state !== 'loading') return;
        try {
          const s = p.getPlayerState();
          if (s === YT_STATE.UNSTARTED || s === YT_STATE.CUED) this._setState('paused');
        } catch (e) { /* ignore */ }
      }, 6000)
    );
    // Hard stall: treat as a failed track.
    this._watchdogs.push(
      setTimeout(() => {
        if (mySeq === this._seq && this._state === 'loading') this._onTrackFailed();
      }, 25000)
    );
  }

  _clearWatchdogs() {
    for (const t of this._watchdogs) clearTimeout(t);
    this._watchdogs = [];
  }

  _onPlayerState(e) {
    const s = e && e.data;
    if (s === YT_STATE.PLAYING) {
      if (this._state === 'announcer') return;
      this._clearWatchdogs();
      this._failStreak = 0;
      this._updateMeta();
      this._setState('playing');
      if (this._fadeInPending) { this._fadeInPending = false; this._rampMusic(this._musicGain ?? 0, 1, 3500); }
    } else if (s === YT_STATE.BUFFERING) {
      if (this._state === 'playing') this._setState('loading');
    } else if (s === YT_STATE.PAUSED) {
      if (this._state === 'playing' || this._state === 'loading') {
        // A pause that we did not request (e.g. tab/system media key): reflect it.
        this._setState('paused');
      }
    } else if (s === YT_STATE.ENDED) {
      if (this._state === 'announcer' || !this._started) return;
      this._breakThenNext();
    }
  }

  _onPlayerError(e) {
    const code = e && e.data;
    if (code !== undefined && !FATAL_CODES.has(code)) {
      // Unknown codes are treated the same way: skip the track.
    }
    if (this._state === 'announcer') return;
    this._onTrackFailed();
  }

  _onTrackFailed() {
    this._clearWatchdogs();
    this._failStreak++;
    const total = Math.max(1, this._playableTracks().length);
    if (this._failStreak >= total) {
      this._fail();
      return;
    }
    const my = ++this._seq;
    this._setState('loading');
    (async () => {
      await sleep(300);
      if (my !== this._seq) return;
      const track = this._pickNext();
      if (!track) {
        this._fail();
        return;
      }
      await this._playTrack(track, my);
    })();
  }

  _updateMeta() {
    const t = this._current;
    const p = this._active();
    if (!t || !p) return;
    try {
      const d = p.getVideoData && p.getVideoData();
      if (!d || (d.video_id && d.video_id !== t.id)) return;
      if (!t.title && d.title) {
        const m = splitMeta(d.title, d.author);
        t.title = m.title;
        t.artist = m.artist;
      }
    } catch (e) { /* ignore */ }
  }

  // Demo: straight into the announcer break, which introduces song b, then song b. `intro` (optional):
  // the lines to say first (the demo's place and fact); the "up next" line is added here.
  async demo(b, intro = null) {
    this._started = true;
    this._primeSpeech();
    this._primeAudio?.();
    if (this._source === 'local') { // the attract loop plays from the local library too (no YouTube)
      try { const tr = await this._loadLocal(); if (tr.length) b = tr[Math.floor(Math.random() * tr.length)]; } catch (e) { /* ignore */ }
    }
    this._demoNext = b;
    if (intro) this._plan = { id: b.id, lines: this._demoScript(b, intro) };
    this._overlap = 2.5;
    this._gain = 0;
    this.fadeTo(1, 1200);
    await this._breakThenNext();
  }

  // ramp the music alone (the voice keeps its level), e.g. a song rising under the announcer's last words
  async _rampMusic(from, to, ms) {
    const t0 = performance.now(), id = (this._mfadeId = (this._mfadeId || 0) + 1);
    for (;;) {
      if (id !== this._mfadeId) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      this._musicGain = from + (to - from) * k * k * (3 - 2 * k);
      this._applyVolume();
      if (k >= 1) return;
      await sleep(60);
    }
  }

  // smooth volume ramp of everything the radio plays (music and announcer), without saving it
  async fadeTo(target, ms) {
    const from = this._gain ?? 1, t0 = performance.now();
    const id = (this._fadeId = (this._fadeId || 0) + 1);
    for (;;) {
      if (id !== this._fadeId) return;
      const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k);
      this._gain = from + (target - from) * e;
      this._applyVolume();
      if (this._audio) this._audio.volume = this._voiceVolume() * this._gain * this._level;
      if (k >= 1) return;
      await sleep(50);
    }
  }

  // tempo of what is on air right now: { playing, speaking, bpm }
  tempo() {
    const t = this._current;
    return { playing: this._state === 'playing', speaking: this._state === 'announcer' || !!this._interjecting, bpm: (t && BPM[t.id]) || STATION_BPM[this._station.id] || 96 };
  }

  // ---- reacting to the drive ----------------------------------------------
  // note(): something just happened (a deer, a shower rolling in); the announcer may bring it up at
  // the next break. Only the freshest couple are kept, and they go stale after a few minutes.
  note(text) {
    if (!text || this._quiet) return;
    this._notes = (this._notes || []).filter((n) => performance.now() - n.at < 240000).slice(-2);
    this._notes.push({ text: String(text), at: performance.now() });
  }
  _takeNote() {
    const fresh = (this._notes || []).filter((n) => performance.now() - n.at < 240000);
    this._notes = [];
    return fresh.length ? fresh[fresh.length - 1].text : null;
  }

  // interject(): say a line or two over the music right now (it dips, then comes back). Used for
  // short true facts at viewpoints. Skipped quietly if the announcer is busy or the radio is off.
  async interject(lines) {
    if (!this._started || this._state !== 'playing' || this._interjecting || this._quiet) return false;
    this._interjecting = true;
    const seq = this._seq;
    try {
      // the music glides down under the voice (never a sudden drop) and back up after
      this._amb('duck', 0.6);
      await this._rampMusic(this._musicGain ?? 1, 0.25, 1200);
      for (const text of lines) {
        for (const sentence of splitSentences(text)) {
          if (seq !== this._seq || this._state !== 'playing') return false;
          this._line = text; this._emit();
          let url = null;
          if (this._ttsUsable()) url = await this._ttsGet(sentence).catch(() => null);
          if (seq !== this._seq || this._state !== 'playing') return false;
          if (url) await this._playClip(url);
          else { const ss = this._synth(); if (ss) await this._speakOne(ss, sentence, seq); else await sleep(1800); }
          await sleep(260);
        }
      }
      return true;
    } catch (e) {
      return false;
    } finally {
      this._interjecting = false;
      this._line = ''; this._emit();
      this._amb('duck', 0);
      if (this._state === 'playing') this._rampMusic(this._musicGain ?? 0.25, 1, 2000);
    }
  }

  // ---- calm ------------------------------------------------------------------
  // A gentle multiplier on everything the radio plays: lower late at night, and slowly down to
  // nothing during a wind-down. Never saved (the volume slider stays what the user set).
  setLevel(f) {
    const v = clamp01(f);
    if (Math.abs(v - this._level) < 0.004) return;
    this._level = v;
    this._applyVolume();
  }
  // Quiet mode: music only. No announcer between songs, no facts or remarks over the music.
  setQuiet(on) {
    this._quiet = !!on;
    if (this._quiet) this._notes = [];
  }
  // songs fade out over their last seconds, so none ends on a hard stop before the next comes in
  _tailTick() {
    if (this._state !== 'playing' || this._tailing || this._interjecting) return;
    try {
      const p = this._active(), d = p?.getDuration?.(), t = p?.getCurrentTime?.();
      if (!(d > 40) || !(t >= 0)) return;
      const left = d - t;
      if (left < 6 && left > 0.5) { this._tailing = true; this._rampMusic(this._musicGain ?? 1, 0, Math.max(500, (left - 0.4) * 1000)); }
    } catch (e) { /* ignore */ }
  }

  // ---- announcer ---------------------------------------------------------

  async _breakThenNext() {
    const my = ++this._seq;
    this._clearWatchdogs();
    this._failStreak = 0;
    this._updateMeta();
    let next = null;
    if (this._station === this._mine) {
      try {
        await this._resolvePlaylists(my);
      } catch (e) { /* ignore */ }
      if (my !== this._seq) return;
    }
    next = this._pickNext();
    if (!next) {
      this._fail();
      return;
    }
    let early = false;
    if (this._quiet) { await this._playTrack(next, my); return; } // quiet mode: song to song, nothing said
    this._setState('announcer');
    this._amb('radioStatic', 1.0);
    this._amb('duck', 0.85);
    try {
      await sleep(450);
      if (my !== this._seq) return;
      const plan = this._plan;
      this._plan = null;
      const lines = plan && plan.id === next.id ? plan.lines : this._script(next);
      // overlap: the song starts under the announcer's last few seconds (crossfade)
      if (this._overlap) this._tailHook = () => {
        if (my !== this._seq || early) return;
        early = true;
        this._musicGain = 0.3;
        this._playTrack(next, my);
        this._rampMusic(0.3, 1, 4000);
      };
      await this._speakLines(lines, my);
    } catch (e) { /* never block the music */ }
    this._tailHook = null;
    if (my !== this._seq) return;
    this._amb('duck', 0);
    if (!early) await this._playTrack(next, my);
  }

  _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  _demoScript(b, intro) {
    const lines = intro.slice();
    const title = speakable(cleanTitle(b.title));
    if (title) lines.push(this._pick(UPNEXT)(title, speakable(cleanArtist(b.artist))));
    return lines;
  }
  // synthesise lines ahead of time, so the voice starts the moment it is needed
  warmLines(intro) {
    try { if (this._ttsUsable()) for (const l of intro) for (const s of splitSentences(l)) this._ttsGet(s); } catch (e) { /* ignore */ }
  }

  // A shuffled bag, remembered across sessions: the quotes heard lately (about the last two-thirds of
  // them) are left out until the rest have had their turn, so no place or evening keeps the same ones.
  _nextQuote() {
    let heard = [];
    try { heard = JSON.parse(LS.get('longdrive.quotesHeard') || '[]'); } catch (e) { heard = []; }
    const keep = Math.floor(QUOTES.length * 0.66);
    if (!this._quoteBag.length) {
      const recent = new Set(heard.slice(-keep));
      const fresh = QUOTES.filter((q) => !recent.has(q));
      this._quoteBag = shuffle(fresh.length ? fresh : QUOTES);
    }
    const q = this._quoteBag.pop();
    heard.push(q);
    LS.set('longdrive.quotesHeard', JSON.stringify(heard.slice(-keep)));
    return q;
  }

  _script(next) {
    let ctx = {};
    try {
      ctx = this.getContext() || {};
    } catch (e) { /* ignore */ }
    const lines = [];
    lines.push(this._pick(IDENTS));

    lines.push(timeLine(ctx, (arr) => this._pick(arr)));
    // something from the drive itself, when there is something to say; otherwise the odd dedication
    const noted = this._takeNote();
    if (noted) lines.push(noted);
    else if (Math.random() < 0.22) lines.push(this._pick(EXTRAS));
    if (!noted || Math.random() < 0.5) lines.push(this._nextQuote());
    const up = upNextLine(next.title, next.artist, (arr) => this._pick(arr));
    if (up) lines.push(up);
    return lines;
  }

  _initVoices() {
    const ss = this._synth();
    if (!ss) return;
    const load = () => {
      try {
        this._voice = this._chooseVoice(ss.getVoices() || []);
        this._voiceLoaded = true;
      } catch (e) { /* ignore */ }
    };
    load();
    try {
      if (ss.addEventListener) ss.addEventListener('voiceschanged', load);
      else ss.onvoiceschanged = load;
    } catch (e) { /* ignore */ }
  }

  _synth() {
    try {
      return typeof window !== 'undefined' && 'speechSynthesis' in window && window.SpeechSynthesisUtterance
        ? window.speechSynthesis
        : null;
    } catch (e) {
      return null;
    }
  }

  _chooseVoice(voices) {
    const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
    if (!en.length) return null;
    const tests = [
      (v) => /premium/i.test(v.name),
      (v) => /enhanced/i.test(v.name),
      (v) => /samantha|ava|allison|daniel/i.test(v.name),
      (v) => /google us english/i.test(v.name),
      (v) => /^en[-_]US/i.test(v.lang),
    ];
    // Prefer US/GB premium voices over exotic ones.
    for (const t of tests) {
      const hit = en.find((v) => t(v) && /^en[-_](US|GB|AU|CA)/i.test(v.lang)) || en.find(t);
      if (hit) return hit;
    }
    return en[0];
  }

  // Some browsers need speech touched once inside the user gesture.
  _primeSpeech() {
    this._primeAudio();
    const ss = this._synth();
    if (!ss) return;
    try {
      ss.cancel();
      if (ss.paused) ss.resume();
    } catch (e) { /* ignore */ }
  }

  _cancelSpeech() {
    try {
      if (this._audio) this._audio.pause();
    } catch (e) { /* ignore */ }
    if (this._clipDone) this._clipDone();
    const ss = this._synth();
    if (!ss) return;
    try {
      ss.cancel();
    } catch (e) { /* ignore */ }
  }

  // Speak the announcer lines: neural voice from /tts when available, else the browser's speechSynthesis.
  async _speakLines(lines, my) {
    if (this._ttsUsable()) {
      const rest = await this._speakLinesTTS(lines, my);
      if (!rest) return; // spoken in full, or cancelled
      lines = rest; // /tts failed part-way: say what is left with speechSynthesis
    }
    await this._speakLinesSS(lines, my);
  }

  async _speakLinesSS(lines, my) {
    const ss = this._synth();
    if (!ss) {
      // No voice available: keep the static swell and a short, calm pause.
      await sleep(2200);
      return;
    }
    try {
      ss.cancel();
    } catch (e) { /* ignore */ }
    for (const text of lines) {
      if (my !== this._seq) return;
      const sentences = splitSentences(text);
      for (const sentence of sentences) {
        if (my !== this._seq) return;
        this._setState('announcer', text);
        await this._speakOne(ss, sentence, my);
      }
      if (my !== this._seq) return;
      await sleep(350);
    }
  }

  _speakOne(ss, sentence, my) {
    return new Promise((resolve) => {
      let finished = false;
      let timer = null;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      try {
        const u = new window.SpeechSynthesisUtterance(sentence);
        if (!this._voiceLoaded) this._initVoicesOnce(ss);
        if (this._voice) {
          u.voice = this._voice;
          u.lang = this._voice.lang;
        } else {
          u.lang = 'en-US';
        }
        u.rate = 0.92;
        u.pitch = 0.95;
        u.volume = 1;
        u.onend = done;
        u.onerror = done;
        // Safety net: a stuck speech engine must never block the music.
        timer = setTimeout(() => {
          try {
            if (my === this._seq) ss.cancel();
          } catch (e) { /* ignore */ }
          done();
        }, 3500 + sentence.length * 110);
        if (ss.paused) ss.resume();
        ss.speak(u);
      } catch (e) {
        done();
      }
    });
  }

  // ---- neural announcer voice (served by scripts/tts.mjs) ------------------

  _ttsUsable() {
    return !STATIC && typeof Audio !== 'undefined' && typeof fetch === 'function' && Date.now() >= this._ttsDownUntil; // no voice server on the static (GitHub Pages) build
  }

  _voiceVolume() {
    return Math.min(1, Math.max(0.4, this._volume)) * this._level;
  }

  // One <audio> element for the whole session, unlocked by the first user gesture.
  _primeAudio() {
    try {
      if (!this._audio && typeof Audio !== 'undefined') this._audio = new Audio();
      const a = this._audio;
      if (!a) return;
      a.preload = 'auto';
      a.volume = 0;
      a.src =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // Fetch (and keep) the audio for one sentence. Resolves to an object URL, or null on failure.
  _ttsGet(sentence) {
    let p = this._ttsCache.get(sentence);
    if (p) return p;
    p = (async () => {
      try {
        const r = await fetch(asset('tts?text=') + encodeURIComponent(sentence));
        if (!r.ok) {
          if (r.status === 503) this._ttsDownUntil = Date.now() + 60000;
          throw new Error('tts ' + r.status);
        }
        return URL.createObjectURL(await r.blob());
      } catch (e) {
        this._ttsCache.delete(sentence);
        if (!this._ttsDownUntil || this._ttsDownUntil < Date.now()) this._ttsDownUntil = Date.now() + 30000;
        return null;
      }
    })();
    this._ttsCache.set(sentence, p);
    while (this._ttsCache.size > 40) {
      const k = this._ttsCache.keys().next().value;
      const old = this._ttsCache.get(k);
      this._ttsCache.delete(k);
      old.then((u) => u && URL.revokeObjectURL(u));
    }
    return p;
  }

  _playClip(url) {
    return new Promise((resolve) => {
      const a = this._audio;
      if (!a) {
        resolve(false);
        return;
      }
      let settled = false;
      let timer = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        a.onended = null;
        a.onerror = null;
        this._clipDone = null;
        resolve(ok);
      };
      this._clipDone = () => finish(true); // cancelled: the caller checks its token
      a.onended = () => finish(true);
      a.onerror = () => finish(false);
      timer = setTimeout(() => {
        try {
          a.pause();
        } catch (e) { /* ignore */ }
        finish(true);
      }, 30000);
      try {
        a.src = url;
        a.volume = this._voiceVolume();
        const p = a.play();
        if (p && p.catch) p.catch(() => finish(false));
      } catch (e) {
        finish(false);
      }
    });
  }

  // Returns null when everything was spoken (or the token was cancelled); otherwise the lines that
  // still need to be spoken by the speechSynthesis fallback.
  async _speakLinesTTS(lines, my) {
    const items = [];
    lines.forEach((text, li) => {
      const ss = splitSentences(text);
      ss.forEach((s, i) => items.push({ text, s, li, last: i === ss.length - 1 }));
    });
    const ensure = (i) => {
      const it = items[i];
      if (it && !it.p) it.p = this._ttsGet(it.s);
    };
    const rest = (i) => {
      const out = [];
      let cur = -1;
      for (let j = i; j < items.length; j++) {
        if (items[j].li !== cur) {
          cur = items[j].li;
          out.push(items[j].s);
        } else out[out.length - 1] += ' ' + items[j].s;
      }
      return out;
    };
    for (let i = 0; i < items.length; i++) {
      ensure(i);
      ensure(i + 1);
      ensure(i + 2); // synthesise upcoming sentences while this one is playing
      const url = await Promise.race([items[i].p, sleep(15000).then(() => null)]);
      if (my !== this._seq) return null;
      if (!url) {
        this._ttsDownUntil = Math.max(this._ttsDownUntil, Date.now() + 30000);
        return rest(i);
      }
      this._setState('announcer', items[i].text);
      const hook = i === items.length - 1 && this._tailHook;
      if (hook && this._audio) {
        // start the song `_overlap` seconds before the voice ends (plus ~1.5 s for YouTube to begin)
        const a = this._audio;
        a.addEventListener('loadedmetadata', () => {
          const d = a.duration;
          setTimeout(hook, isFinite(d) ? Math.max(0, (d - this._overlap - 1.5) * 1000) : 0);
        }, { once: true });
      }
      const ok = await this._playClip(url);
      if (my !== this._seq) return null;
      if (!ok) {
        this._ttsDownUntil = Math.max(this._ttsDownUntil, Date.now() + 30000);
        return rest(i);
      }
      await sleep(items[i].last ? 450 : 220);
      if (my !== this._seq) return null;
    }
    return null;
  }

  // While a song plays, prepare the next break's lines so the voice is ready (first-time synthesis
  // never causes dead air). Reads the queue only; it never changes what the music does.
  _prefetchTick() {
    try {
      const p = this._active();
      if (this._state !== 'playing' || !p || !this._ttsUsable()) return;
      const dur = p.getDuration && p.getDuration();
      const cur = p.getCurrentTime && p.getCurrentTime();
      // two minutes ahead: the voice is ready long before the song ends (synthesis takes ~10 s a break)
      if (!(dur > 0) || !(cur >= 0) || dur - cur > 120) return;
      this.prepareBreak();
    } catch (e) { /* ignore */ }
  }

  // Write the next break's lines and have the voice synthesised now, so that when the song ends the
  // announcer starts straight away. Safe to call repeatedly.
  prepareBreak() {
    try {
      if (!this._ttsUsable()) return;
      if (!this._demoNext && !this._queue.length && this._station !== this._mine) {
        const tracks = this._playableTracks();
        if (tracks.length) this._queue = shuffle(tracks).filter((t, i, a) => i === 0 || t.id !== this._lastId);
      }
      const next = this._demoNext || (this._station === this._mine ? null : this._queue[0]);
      if (!next || !next.id || (this._plan && this._plan.id === next.id)) return;
      const lines = this._script(next);
      this._plan = { id: next.id, lines };
      for (const l of lines) for (const s of splitSentences(l)) this._ttsGet(s);
    } catch (e) { /* ignore */ }
  }

  _initVoicesOnce(ss) {
    try {
      const v = ss.getVoices() || [];
      if (v.length) {
        this._voice = this._chooseVoice(v);
        this._voiceLoaded = true;
      }
    } catch (e) { /* ignore */ }
  }
}
