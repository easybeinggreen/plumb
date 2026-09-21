// "Desk gym": five seated office stretches, on demand only -- never a prompt.
// General office-ergonomics guidance, not medical advice. `what` is deliberately
// two sentences: what the move is, then why it helps.
//
// Demo links are YouTube *searches*, not specific videos: a search URL is
// always valid, whereas a hand-picked video ID can't be verified from here.
// An entry may carry `video`, a link the owner chose, which wins over the search.

export const DESK_GYM = [
  {
    id: 'chin-tuck',
    name: 'Chin tucks',
    what: 'Sit tall and glide your chin straight back, as if making a double chin, hold for a second, then release; repeat five times. It counters the forward head position that creeps in when you lean toward a screen.',
    query: 'seated chin tuck exercise office desk',
    video: 'https://www.youtube.com/shorts/pAps-PUqwv0'
  },
  {
    id: 'neck-side',
    name: 'Ear-to-shoulder neck stretch',
    what: 'Let one ear drop toward its shoulder while the other shoulder stays relaxed and down, holding for 15 to 20 seconds each side. It eases the side-neck muscles that tighten during long stretches of focus.',
    query: 'seated side neck stretch upper trapezius office'
  },
  {
    id: 'shoulder-rolls',
    name: 'Shoulder rolls and blade squeeze',
    what: 'Roll your shoulders up, back and down in five slow circles, then gently squeeze your shoulder blades together for a few seconds. It loosens hunched shoulders and reminds your upper back to hold you up instead of your neck.',
    query: 'seated shoulder rolls scapular squeeze office stretch'
  },
  {
    id: 'chest-opener',
    name: 'Chest opener',
    what: 'Clasp your hands behind your head, open your elbows wide, then lift your chest and lean gently back over the top of your chair for a few breaths. It undoes the rounded upper back that typing builds and makes sitting tall easier.',
    query: 'seated chest opener thoracic extension chair desk stretch'
  },
  {
    id: 'seated-twist',
    name: 'Seated twist',
    what: 'Sit tall and turn your upper body to one side, holding the back of your chair or your knee, for 15 to 20 seconds each way. It frees the stiff mid-back that long hours of sitting lock up.',
    query: 'seated spinal twist chair office stretch'
  }
];

export const DESK_GYM_NOTE = 'General office ergonomics guidance, not medical advice. Move gently, and stop if anything hurts.';

export function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
