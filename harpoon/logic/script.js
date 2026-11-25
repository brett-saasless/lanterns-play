// Every word the Rose Court level and the castle show: story cards, Renfield's lines, the
// castle's speakers, the warden's log, the interact verbs and the place banners. Data only. Tables use the key `kind`, never `type`,
// because tests/sounds.test.js reads `type: '...'` literals in logic/ as event names.

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};

/** The story cards (log entry left, found document right): three for the court, and the dawn card that ends the castle. */
export const CARDS = f({
  arrive: {
    log: 'The singing has stopped. It did not come this way to hide. It came this way to go home. There is daylight above me, which is wrong. I have been walking down all night.',
    document: { kind: 'label', text: 'To be left until called for. The house beyond the Rose Court.' },
  },
  arch: {
    log: 'A garden. White roses, guards who smile a little too long, and a man eating beetles with a fork. He says the master dines at midnight. The trail goes under the hedge.',
    document: { kind: 'note', text: 'Everything that lives is on the menu, if one is patient. R.' },
  },
  end: {
    log: 'Four of them in the wood, and not one died the way a thing should. The rain has started. The house has its bridge down. It is expecting someone. I do not think it is me.',
    document: { kind: 'ticket', text: 'In this Style 10/6.' },
  },
  // The after-the-dawn card (the castle's last): shown when the warden walks to the middle window.
  dawn: {
    log: 'Opened the curtains. Box fifty is accounted for. Going off shift.',
    document: { kind: 'label', text: 'Consignee: none. Received by: the Warden.' },
  },
});

/**
 * The dock's two cards (docs/features/sea-1-dock/02-design.md, "Lines for the owner's approval",
 * APPROVED 2026-11-21): through the gap, and casting off. Kept apart from CARDS: tests/script.test.js
 * pins CARDS to exactly the castle's four keys (Object.keys(CARDS)), a correctness check for that
 * track, not a ceiling future tracks must thread new cards through.
 */
export const DOCK_CARDS = f({
  dockArrive: {
    log: 'The wall is down and there is a harbour behind it. Nobody told me the yard had a harbour. Lanterns, masts, tar. A ship is taking hands.',
    document: { kind: 'label', text: 'WANTED. Able hands for the ship PEQUOD of Nantucket. Three years. Apply on board.' },
  },
  dockClose: {
    log: 'Signed. Kit in a chest. Gold on the mast and a brass lamp that burns nothing. We are under way.',
    document: { kind: 'ticket', text: 'The 300th lay. Witnessed: Peleg.' },
  },
});

/**
 * Speakers' display names (shown in small capitals above a line). The plot gardeners have no
 * entry, so their plate shows the line alone (wonderland-polish design, Conflicts 5).
 */
export const NAMES = f({
  renfield: 'Renfield', rabbit: 'The White Rabbit', hatter: 'The Hatter-at-Arms', hunter: 'A hunter',
  // The castle's three named speakers. The phantom wife ('wife') has no entry: her whisper
  // shows the line alone.
  armour: 'The Armour', hare: 'The March Hare', raven: 'The Raven',
});

/**
 * The dock's three speaker names (approved 2026-11-21). Kept apart from NAMES:
 * tests/journal.test.js pins script.NAMES to the shipped seven exactly.
 */
export const DOCK_NAMES = f({ elijah: 'Elijah', ned: 'Ned Land', peleg: 'Captain Peleg' });

/** Renfield's lines, by key (the decisions record's text, unchanged). */
export const LINES = f({
  approach: { who: 'renfield', text: 'Do sit. No? You will forgive me if I go on. They are best while they still glow.' },
  second: { who: 'renfield', text: 'From below, yes. The cave sends them up. Small lives, but one must begin somewhere.' },
  clue: { who: 'renfield', text: 'You are expected, I think. The master dines at midnight. Always at midnight. The clocks disagree, but the clocks are wrong.' },
  again: { who: 'renfield', text: 'Midnight. Do write it down. Guests who are late are still served.' },
  after: { who: 'renfield', text: 'I have told you the hour. I cannot tell you the way; I have never been asked inside.' },
  white: { who: 'renfield', text: 'White will not do. He likes them red. Everything here must be made red before it is let through.' },
  roses: { who: 'renfield', text: 'There. Now you look like a guest.' },
  salt: { who: 'renfield', text: 'Salt. How thoughtful. I take mine plain.' },
  warm: { who: 'renfield', text: 'You are warm. It has been some time since anything warm sat at this table.' },
  arch: { who: 'renfield', text: 'Mind the Rabbit. He was such a punctual creature, before.' },

  // The wonderland polish track's lines (docs/product/world-and-level3-decisions.md, approved
  // 2026-11-14), unchanged. talk.js says them in order.
  // The White Rabbit: two greeting lines, five on Speak, five warnings before he attacks.
  rabbitGreet1: { who: 'rabbit', text: 'Oh my fur and whiskers. A guest. I did not send for a guest.' },
  rabbitGreet2: { who: 'rabbit', text: 'This is my table and my supper and you are very, very late for it. Go away!' },
  rabbitTalk1: { who: 'rabbit', text: 'Hungry? Of course I am hungry. I have been hungry since a quarter past forever.' },
  rabbitTalk2: { who: 'rabbit', text: 'Salad of the garden. That is all I ask. Nothing that grows in the dark by the hedge.' },
  rabbitTalk3: { who: 'rabbit', text: 'Garlic? Do not say that word at my table. Do not even think it in that tone.' },
  rabbitTalk4: { who: 'rabbit', text: 'Carrots, now. Carrots are a kindness. Nobody brings me carrots any more.' },
  rabbitTalk5: { who: 'rabbit', text: 'You are still here. Why are you still here. I can hear your heart. It is very loud.' },
  rabbitWarn1: { who: 'rabbit', text: 'Not one step nearer. I am a creature of very regular habits, and you are not one of them.' },
  rabbitWarn2: { who: 'rabbit', text: 'The Duchess will hear of this. Everyone will hear of this.' },
  rabbitWarn3: { who: 'rabbit', text: 'My watch says it is time for you to leave. My watch is never wrong.' },
  rabbitWarn4: { who: 'rabbit', text: 'I am counting. I was always good at counting. I count teeth now.' },
  rabbitWarn5: { who: 'rabbit', text: 'Late. Late. Too late for you.' },
  // The Hatter-at-Arms: two on entering, five taunts, one on his death.
  hatterGreet1: { who: 'hatter', text: 'No room. No room. Do you see a seat? Then there is no room.' },
  hatterGreet2: { who: 'hatter', text: 'You have come at the wrong time. It is always the wrong time here. I saw to that.' },
  hatterTaunt1: { who: 'hatter', text: 'Why is a raven like a gun? Neither one will tell you before it goes off.' },
  hatterTaunt2: { who: 'hatter', text: 'Change places! Move down! There is cover over there, if you run like a teapot.' },
  hatterTaunt3: { who: 'hatter', text: 'I have a pin for every hat and a hat for every head. Yours will do nicely.' },
  hatterTaunt4: { who: 'hatter', text: 'Clean cup! Clean cup! Yours is about to be very dirty.' },
  hatterTaunt5: { who: 'hatter', text: 'Your manners want cutting. So does your hair. I have just the thing.' },
  hatterDeath: { who: 'hatter', text: 'Tell Time. Tell him I said sorry. He will not listen.' },
  // The dying hunter outside the Bat's glade: four on Speak, the fourth repeating.
  hunter1: { who: 'hunter', text: 'Don\'t. Don\'t go in there. I put six bolts through it and every one came out the other side.' },
  hunter2: { who: 'hunter', text: 'It isn\'t there, you see. Only the grin. The grin and the teeth and then you\'re bleeding.' },
  hunter3: { who: 'hunter', text: 'A riddle, then, since I\'m dying and it\'s the fashion here: what makes a shadow, but has none of its own; hangs on a chain, and falls when you ask it?' },
  hunter4: { who: 'hunter', text: 'Light. It\'s only real in the light. I worked that out too late. You\'ve got time. Look up.' },
  // The frightened gardeners at the vegetable plots (no name: Conflicts 5).
  gardenerCarrot: { who: 'gardener', text: 'The Rabbit\'s carrots. Sweetest in the wood. He\'d do anything for a carrot. He\'d eat anything with a carrot in it.' },
  gardenerGarlic: { who: 'gardener', text: 'Don\'t let him see you picking that. He hates it worse than The Cross. Worse than daylight, nearly.' },

  // The castle's lines (docs/features/castle/02-design.md, "Lines for the owner's approval",
  // approved 2026-11-15). The first suit of armour, then the second suit's two threats, three
  // taunts and last line. The wife's whisper has no speaker name.
  armourFirst: { who: 'armour', text: 'Halt. Who comes to the house with a still beating heart? Make your sacrifice!' },
  armourThreat1: { who: 'armour', text: 'My fellow has lost his head. I never had one. Stand where you are.' },
  armourThreat2: { who: 'armour', text: 'The master has another guest. I require the blood organs first!' },
  armourTaunt1: { who: 'armour', text: 'Stand still. It is so much tidier.' },
  armourTaunt2: { who: 'armour', text: 'Ten and six, says the ticket on the pike. You will not get change.' },
  armourTaunt3: { who: 'armour', text: 'There is nothing in here to shoot. I have looked.' },
  // DRAFT for owner approval (#14): the first suit's rust complaints while it crumbles.
  armourRust1: { who: 'armour', text: 'Oh, my elbow. Rust. Nothing but rust. Nobody oils a sentry in this house.' },
  armourRust2: { who: 'armour', text: 'A knee gone now. Forty years of damp, and not one word of thanks.' },
  armourLast: { who: 'armour', text: 'Dismissed, then. Tell the door I held it.' },
  wifeWhisper: { who: 'wife', text: 'Warm. A body warm, sisters. Who is to have it first?' },
  ravenMock1: { who: 'raven', text: 'Missed. Try the writing-desk. It holds still.' },
  ravenMock2: { who: 'raven', text: 'Salt on my tail? You must catch it first.' },
  ravenMock3: { who: 'raven', text: 'A poor shot and a late guest. He will be so pleased.' },
  hare1: { who: 'hare', text: 'Is it six o\'clock? It is always six o\'clock. I had a train at six, and a letter to post, and a wife to write to.' },
  hare2: { who: 'hare', text: 'I came about the deeds. A house in London for a foreign gentleman. Most courteous. He would not hear of my leaving.' },
  hare3: { who: 'hare', text: 'Do not mind the coffin. I have knocked and knocked. Nobody is ever at home.' },
  // Said after the warden's first fall into the crypt.
  hareRiddle: { who: 'hare', text: 'You came down the quick way. Everyone does. Ask the glass. It is the one honest thing in this house, and it says everything back to front. What it will not show you will not hold you.' },
});

/**
 * The dock's lines (docs/features/sea-1-dock/02-design.md, "Lines for the owner's approval",
 * APPROVED 2026-11-21, "with changes flagged at play-test"). Elijah's greeting, then his riddle
 * in order (Melville ch. 19 for the greeting and the close); Ned Land at the contest; Peleg at
 * the gangway's head. Kept apart from LINES: tests/journal.test.js pins Object.keys(LINES).length
 * to the court's and castle's shipped total, a correctness check for those tracks, not a ceiling.
 * dock.js (via journal.speak and talk.js) reads this table the same way; see also DOCK_SPEAKERS
 * in talk.js, which lists the keys Elijah's ladder may say.
 */
export const DOCK_LINES = f({
  elijahGreet1: { who: 'elijah', text: 'Shipmates, have ye shipped in that ship?' },
  elijahGreet2: { who: 'elijah', text: 'Anything down there about your souls?' },
  elijah1: { who: 'elijah', text: 'No papers yet? Then hear me. Three things Peleg asks of a green hand, and this wharf holds all three.' },
  elijah2: { who: 'elijah', text: 'First, the loop that will not slip and will not jam. It has held drowning men. Look where rope is sold.' },
  elijah3: { who: 'elijah', text: 'Second, your share. The harpooneer takes the fat lay and the miser offers the thin one. Yours lies between.' },
  elijah4: { who: 'elijah', text: 'Third, a book that has been where ye are going. It lies in a boat that goes nowhere, under the boards ye stand on.' },
  elijah5: { who: 'elijah', text: 'Once ye have signed, there is gold wants nailing. A tower, a flame, a cock that crows. Find all three at once.' },
  elijah6: { who: 'elijah', text: 'Mind what follows her. A ship that sails without sails and burns without fire. Morning to ye, shipmates. Morning.' },
  ned1: { who: 'ned', text: 'Three barrels, three irons. Beat me and he ships with you, not me.' },
  ned2: { who: 'ned', text: 'Fair throw.' },
  ned3: { who: 'ned', text: 'Mine. Again, whenever you like.' },
  ned4: { who: 'ned', text: 'Well thrown. He is yours. I will find another ship, and something bigger to stick.' },
  peleg1: { who: 'peleg', text: 'Want to ship, dost thou? Then show me a knot, a lay and a log, and thou art a whaleman.' },
  peleg2: { who: 'peleg', text: 'Not yet. I am still wanting:' },
  pelegKnot: { who: 'peleg', text: 'That will slip or it will jam. Bring me the one that does neither.' },
  pelegLayFat: { who: 'peleg', text: 'The ninetieth? That is a harpooneer\'s lay. Put it back.' },
  pelegLayThin: { who: 'peleg', text: 'The seven hundred and seventy-seventh. That is Bildad\'s joke. Put it back.' },
  peleg3: { who: 'peleg', text: 'Bowline, three hundredth lay, and a log with salt in it. Sign there. Thy kit goes in the chest.' },
});

/**
 * The warden's log. kind: 'note' (colour), 'clue' (helps, looks the same) or 'plain' (a hint
 * ladder line, written in after 210 s without progress; also looks the same). The story
 * cards' log halves are entries too (fromCave, toForest, toCastle), so the log always holds
 * at least two notes and a clue can always sit inside a page.
 */
export const ENTRIES = f({
  fromCave: { kind: 'note', text: CARDS.arrive.log },
  arrive: { kind: 'note', text: 'Up out of the hole into a lawn. Somebody has been clipping it. Nobody has been clipping it lately.' },
  boxes: { kind: 'note', text: 'Two of the fifty, lids off, earth still in. Cargo does not unpack itself. Noted.' },
  sundial: { kind: 'note', text: 'The dial\'s shadow lies toward the sun. I walked round it twice. It is not my instrument.' },
  signS: { kind: 'clue', text: 'A post with four arms, a suit on each, and not one arm pointing at its own bed. Top arm is the freshest paint.' },
  signN: { kind: 'clue', text: 'A second post by the north walk, arms all at one height, each pointing at its own bed, paint flaking. The two posts agree on nothing.' },
  halfBed: { kind: 'clue', text: 'Hearts bed, half red, half white, and the red is paint. The other three they left alone. This one never got its water.' },
  watch: { kind: 'note', text: 'A watch hung in a tree, stopped. On the hour, but which hour?' },
  door: { kind: 'note', text: 'A door in the hedge the size of a hatbox. Locked. I did not try very hard.' },
  chain: { kind: 'note', text: 'A chain staked by the north walk, collar sprung from the inside. Whatever wore it has a thick neck.' },
  statue: { kind: 'note', text: 'The fountain girl has wings at the back. From the front you would never know.' },
  arch: { kind: 'note', text: 'A house on a hill past the hedge, due north. One window lit, at noon. The gravel walk points straight at it.' },
  garlic: { kind: 'clue', text: 'Garlic gone wild by the south hedge, all leaf and no bulb. The guards have trodden every bed in this garden but that corner.' },
  throne: { kind: 'note', text: 'A heart cut into the chair back and then scratched out, deep. The crossbow on the seat was left by someone who meant to come back.' },
  hour: { kind: 'clue', text: 'Renfield says the master dines at midnight.' },
  firstTurn: { kind: 'note', text: 'They can move. They were waiting to be asked.' },
  water: { kind: 'clue', text: 'The tall one would not step over a gutter with water in it. Stood there smiling at it.' },
  firstSlam: { kind: 'clue', text: 'Opened one wheel and another spun itself shut across the lawn. The plumbing has opinions.' },
  fountain: { kind: 'note', text: 'All four beds red. It is not paint and I do not think it is rust.' },
  toForest: { kind: 'note', text: CARDS.arch.log },
  wood: { kind: 'note', text: 'Clipped box and bluebells. A wood kept like a parlour.' },
  menu: { kind: 'clue', text: 'Menu card at the bowl. Supper is salad of the garden. Underneath, twice, in a shaky hand: no garlic.' },
  rabbitShot: { kind: 'clue', text: 'Put salt where he was sitting. He was not sitting there. He looked at his watch.' },
  rats: { kind: 'note', text: 'Rats now. They want nothing from me, which is a change.' },
  pit: { kind: 'note', text: 'The floor of this wood is not all floor.' },
  grin: { kind: 'clue', text: 'Something smiled at me in a blind corner. Nothing attached to it. I checked.' },
  pins: { kind: 'note', text: 'Hat-pins, a hand long, thrown like he was paid by the pin. They stay where they land.' },
  lantern: { kind: 'clue', text: 'Cut a lantern down and the smile over it grew a body for as long as the oil lasted.' },
  cup: { kind: 'clue', text: 'A tin cup on a stone by running water. Somebody drinks here. I would not.' },
  smoke: { kind: 'clue', text: 'The smoke bites. The thing in it has a pipe and all the time in the world.' },
  rain: { kind: 'note', text: 'Rain. The first honest thing since the yard.' },
  toCastle: { kind: 'note', text: CARDS.end.log },
  // The wonderland polish track's entries (approved 2026-11-14), unchanged.
  hunter: { kind: 'clue', text: 'A hunter by the glade, nearly gone. He says the thing is only real in the light, and told me to look up.' },
  gardeners: { kind: 'clue', text: 'The gardeners say the Rabbit would eat anything with a carrot in it, and hates garlic worse than The Cross.' },
  cupNote: { kind: 'clue', text: 'Stream water in the cup puts the pipe out. The rain would, if it hurried.' },
  // Reading the card on the hat stand writes its own words (the ladder's 210 s rung writes the
  // same entry if the card has not been read: there is no other approved plain line for it).
  hatCard: { kind: 'clue', text: 'EVERY HAT IN ITS PLACE, AND EVERY PLACE BY PRICE. Cheapest by the door.' },
  // The hint ladder's plainer lines (journal.js writes them in after 210 s).
  plainRoses: { kind: 'plain', text: 'The post by the south walk has four arms. Read it from the top.' },
  plainRabbit: { kind: 'plain', text: 'He will not take salt. He looks at the bowl. Garlic grows in this wood, and something orange.' },
  plainHatter: { kind: 'plain', text: 'The hat takes anything. Under the brim he is as soft as anyone.' },
  plainBat: { kind: 'plain', text: 'It is only there when the light is on it. The lanterns hang on chains. Chains can be shot.' },
  plainCaterpillar: { kind: 'plain', text: 'The smoke is the pipe. The pipe is a coal. I have seen a stream and a cup.' },

  // The castle's entries (approved 2026-11-15). The Castle start's clue card shows `hour`
  // above (Renfield's hour, unchanged); the dawn card's log half is `dawn`.
  garlicScratch: { kind: 'clue', text: 'Scratched by the nail: bullets go through them, garlic they cannot abide. Somebody learned it here.' },
  hare: { kind: 'clue', text: 'A hare in a solicitor\'s coat, chained in the crypt. He says the mirror tells the truth, backwards: what it does not show will not hold me.' },
  boardPlate: { kind: 'clue', text: 'WHITE TO MOVE. One knight and no other piece. Black does not move. Black keeps what it guards. Reach the far rank. The king need not fall.' },
  dawn: { kind: 'note', text: CARDS.dawn.log },
  plainClocks: { kind: 'plain', text: 'Five clocks, all stopped on the hour, no two agreeing on which. Renfield gave me the hour. A clock that is right starts to tick.' },
  plainGallery: { kind: 'plain', text: 'The carpet is not in the glass. Neither is half the floor. Walk on what the mirror shows, and mind that it swaps left for right.' },
  plainBoard: { kind: 'plain', text: 'I go as the knight goes. A square one of theirs can reach costs me blood when I land on it. Landing on one of them takes it off the board. I do not have to take the king. I only have to reach the back row.' },
  // ---- issues #7, #8: the Count's room (DRAFT, for the owner's approval) ----
  // The card by the Count's door (READS.curtainNote is its found words), and the plain line a
  // death in his room writes for the next curtain still shut (count.js CURTAIN_PLAIN).
  curtainNote: { kind: 'clue', text: 'A card tacked up by his door: salt for the padlock, stakes for the hem nails, and the middle cord last, so the light falls on him.' },
  plainLock: { kind: 'plain', text: 'The padlock on the window nearest the door takes no key. Salt eats it. Two good blasts, close.' },
  plainNails: { kind: 'plain', text: 'The far curtain is nailed down at the hem. Three nails, low on the skirting. A stake to each.' },
  plainCord: { kind: 'plain', text: 'The middle cord will not give while a side curtain is shut. Both sides open, then pull it, and keep pulling.' },

  // The dock's log entries (approved 2026-11-21). The two cards' halves are entries too, as the
  // other rooms'. Elijah's riddle helps every puzzle in the chapter (R4): a clue. The monster and
  // scare entries are the chapter's payoff, read for what they are: clues too (they are what the
  // play-test's "no unreadable clue" promise is about). The proofs entry is flavour once signed on.
  dockArrive: { kind: 'note', text: DOCK_CARDS.dockArrive.log },
  dockClose: { kind: 'note', text: DOCK_CARDS.dockClose.log },
  dockRiddle: { kind: 'clue', text: 'Elijah\'s riddle: three things Peleg wants (a loop that will not slip or jam; a share between the fat and the thin; a book where ye are going, under the boards). Gold wants nailing: a tower, a flame, a cock, all three at once. Mind what follows her: a ship that sails without sails and burns without fire.' },
  // The four tavern clippings, each written to the log as it is read (R7); DOCK_CLIPPINGS below carries the same wording for the newsprint card.
  clipping1: { kind: 'note', text: '20 July 1866. The steamer Governor Higginson met a moving mass five miles off the east coast of Australia. Two columns of water rose from it, a hundred and fifty feet into the air.' },
  clipping2: { kind: 'note', text: '23 July 1866. The Cristobal Colon reports the same in the Pacific, seven hundred leagues away, three days later. No whale known to science covers such a distance in such a time.' },
  clipping3: { kind: 'note', text: 'A long object, spindle-shaped, occasionally phosphorescent, and infinitely larger and more rapid in its movements than a whale. So the captains agree. The learned societies do not.' },
  clipping4: { kind: 'note', text: 'To the Editor. Sir, I struck it fair with a two-flued iron off the Banks. The iron rang, as on a boiler. It did not sound like a fish. I am forty years a whaleman.' },
  dockMonster: { kind: 'clue', text: 'Four papers. Faster than any whale, and it shines, and an iron rings on it. Not a fish. Something made.' },
  dockScare: { kind: 'note', text: 'Something came up under the pier. Steel, in plates, lit from below with a light that was not a flame. Then it was not there.' },
  dockProofs: { kind: 'note', text: 'A bowline, the 300th lay, a wet log. Peleg calls that a whaleman.' },
  // The dock's hint ladder (Numbers: proofs after 240 s, the glass at 90, 150, 210 s).
  plainDockKnot: { kind: 'plain', text: 'The chandler\'s board. The loop that neither slips nor jams is the bowline.' },
  plainDockLay: { kind: 'plain', text: 'The tickets are on the inn\'s bar. The middle share is yours.' },
  plainDockLogNoHarpoon: { kind: 'plain', text: 'The boat under the pier wants a harpoon. Ned Land is throwing for one at the pier\'s end.' },
  plainDockLog: { kind: 'plain', text: 'The boat under the pier is out of reach by hand, not by harpoon.' },
  plainDockGlass1: { kind: 'plain', text: 'Each mark on the coin wants its own thing ashore or aboard.' },
  plainDockGlass2: { kind: 'plain', text: 'Tower on the lighthouse, cock on the weathervane. Then walk the collar round.' },
  plainDockGlass3: { kind: 'plain', text: 'Walk the collar until the flame sits on the try-works fire.' },
});

/** The interact prompt's verbs (the key is shown beside the verb). set: a hat on a peg (R19). */
export const PROMPTS = f({
  turn: 'Turn', take: 'Take', read: 'Read', speak: 'Speak', mix: 'Mix',
  fill: 'Fill', douse: 'Douse', pull: 'Pull', climb: 'Climb', set: 'Set',
  // The castle's two (Leap on the board; Hold up the garlic).
  leap: 'Leap', holdUp: 'Hold up',
  takeLantern: 'Take the lantern', // the hand lantern on its nail in the hall
});

/**
 * The dock's verbs (approved 2026-11-21). Take, Read and Speak are shipped already. Kept apart
 * from PROMPTS: tests/journal.test.js pins Object.values(PROMPTS) to the shipped list exactly.
 */
export const DOCK_PROMPTS = f({
  throw: 'Throw', haul: 'Haul', raiseGlass: 'Raise the glass', lowerGlass: 'Lower the glass',
  nailIt: 'Nail it', sign: 'Sign', putBack: 'Put back',
});

/**
 * Found words the clue card shows as they are written, by `read` key (R13, R19, R24). Any other
 * read key shows the warden's log entry of the same key. Reading one writes ENTRIES[key].
 */
export const READS = f({
  hatCard: 'EVERY HAT IN ITS PLACE, AND EVERY PLACE BY PRICE. Cheapest by the door.',
  // The garlic scratched in the stone by the braid (the castle's hall), word for word.
  garlicScratch: 'Bullets go through them. Hold up the garlic and they cannot abide it.',
  cupNote: 'Rain\'s coming. When it does, the old grub\'s pipe gutters and he goes soft as butter. Till then, a cup of stream water does the same. Don\'t ask me how I know.',
  // Issue #8 (DRAFT, for the owner's approval): the card tacked up by the Count's door.
  curtainNote: 'His curtains, at first light. Near window: the padlock takes no key, but salt eats it. Far window: nailed at the hem. A stake draws a nail. The middle cord last of all, so the light falls on him.',
});

/** The hats' price tags (hats.js HATS keys), shown on the prompt line after the verb (R19). */
export const TAGS = f({
  style26: 'In this Style 2/6',
  style5: 'In this Style 5/-',
  style76: 'In this Style 7/6',
  style106: 'In this Style 10/6',
  style126: 'In this Style 12/6',
});

/**
 * The notice line under the prompt, by `notice` key (R10, R19): an item's name on pickup, and
 * the two hat narration lines. Garlic and carrot are just their names. Keys: trail.js
 * NOTICE_KEYS for things taken (stake, cupEmpty when the cup is taken, cupFull when it is
 * filled, halberd), the pickup kinds for things walked over (ammo is the salt, health the
 * tonic: pickups.js), and the hats' two outcomes.
 */
export const NOTICES = f({
  garlic: 'Garlic',
  carrot: 'Carrot',
  cupEmpty: 'Tin cup. Bone dry.',
  cupFull: 'Tin cup, full of stream water. Cold. Running water, still moving in the cup.',
  stake: 'Wooden stake. For the crossbow, or for close work.',
  ammo: 'Salt. For the salt gun.',
  halberd: 'Halberd. Heavy. A guard won\'t need it now.',
  health: 'A tonic. It tastes of iron. It helps.',
  lantern: 'A hand lantern, oil still in it.', // the castle's (the owner's pick)
  hatsFall: 'The hats tumble off the pegs. The card is very clear about prices.',
  hatsSolved: 'Five hats, five pegs, and the gate gives a little cough and swings open.',
});

/**
 * The dock's static notices (approved 2026-11-21). Kept apart from NOTICES: tests/ui.test.js
 * walks every NOTICES key in order and checks the line left showing afterward, so growing that
 * table changes what is "last" there. The ones with a variable part (score, the knot or lay
 * ticket's own name, the clipping count) are built from DOCK_NOTICE_TEMPLATES below instead, and
 * shown with notice({ text }) rather than a key lookup.
 */
export const DOCK_NOTICES = f({
  contestIron: 'A contest iron. Heavier than it looks.',
  dockHarpoon: 'Queequeg\'s harpoon. Fire throws it. The line brings it home.',
  boatFar: 'A whaleboat on its painter. Too far to reach by hand.',
  dockLog: 'A whaling log. The last page is still wet.',
  riddleLogged: 'Elijah\'s riddle, added to your log.',
  stowed: 'Kit stowed in the sea chest.',
  dockDunk: 'Cold. Hands haul you out by the collar.',
  doubloonFound: 'A gold doubloon. Three peaks: a tower, a flame, a crowing cock.',
});

/**
 * The dock's three templated notices (approved 2026-11-21, the parenthesised part is the
 * variable one): the contest tally, a knot's or lay ticket's own name, and the clipping count.
 */
export const DOCK_NOTICE_TEMPLATES = f({
  score: (ned, warden) => `Ned Land (${ned}). You (${warden}).`,
  knot: (name) => `${name}, tied in tarred line.`,
  lay: (name) => `A lay ticket. The ${name} lay.`,
  clipping: (count) => `A newspaper clipping. ${count} of four.`,
});

/** Ammunition plate labels for the two new weapons, from their approved names (Conflicts 5). */
export const LABELS = f({ halberd: 'Halberd', cup: 'Tin cup', lantern: 'Lantern' }); // lantern: the castle's hand lantern

/**
 * Place banners by checkpoint index: the arrival point, the arch, then each gate passed.
 * Index 0 is what the lost card names for a death before the arch.
 */
export const PLACES = f([
  'The Rose Court',
  'The hedge arch',
  'The Rabbit\'s gate',
  'The Hatter\'s gate',
  'The Bat\'s gate',
  'The Caterpillar\'s gate',
]);

/** Title and card copy for this room. */
export const COPY = f({
  button: 'Rose Court',
  subline: 'A garden in daylight. It did not come this way to hide.',
  lost: 'Warden down',
  tryAgain: 'Try again',
  backToTitle: 'Back to title',
  logged: 'added to your log', // as the owner wrote it, lower case: as a clue card closes
});

/**
 * The castle's place banners by stage index 0 to 6 (the checkpoint index): the drawbridge, then
 * one for each checkpoint passed. Index 0 is what the lost card names for a death before the door.
 */
export const CASTLE_PLACES = f([
  'The drawbridge',
  'The castle door',
  'Tea for the Dead',
  'The Looking-Glass Gallery',
  'The Knight\'s Walk',
  'Here lies the master',
  'The Count\'s door',
]);

/**
 * The small line under a castle place banner, by stage index (the owner, 2026-11-19: tell the
 * player the Knight's Walk is won on the far rank, not by taking the king). Stages not listed
 * show the place name alone.
 */
export const CASTLE_PLACE_SUBS = f({
  4: 'Reach the far rank. The king need not fall.',
});

/** The place plate on the walk from the Caterpillar's gate to the road (the owner's review, 2026-11-19). */
export const WALK_PLACE = 'The Wood Path';

/** The title's Castle button and subline (the two sentences of the forest-to-castle entry), and the controls notes. */
export const CASTLE_COPY = f({
  button: 'Castle',
  road: 'Road', // the title's Road start (the owner, 2026-11-17): the road's foot, a few steps out of the wood
  tunnel: 'Tunnel', // the title's Tunnel start (the owner, 2026-11-19): just through the Caterpillar's gate, on the walk to the road
  tunnelSub: 'The Caterpillar is dead and his gate stands open. The way on winds out of the wood.', // DRAFT, for the owner's approval
  subline: 'The house has its bridge down. It is expecting someone.',
  controls: '(Rose Court, Castle)',
  // Issue #20 (DRAFT, for the owner's approval): the banner after the triumph, before the closing card.
  theEnd: 'The End',
});

/** The dock's place banners by zone id (dockmap.js BANNER_OF carries the mapping; approved 2026-11-21). */
export const DOCK_PLACES = f({ quay: 'The Wharf', pier: 'The Wharf', tavern: 'The Spouter-Inn', underPier: 'Under the Pier', deck: 'The Pequod' });

/** The title's Dock button and subline, and the load-failure hint on the shipped "Yard secured" card. */
export const DOCK_COPY = f({
  button: 'Dock',
  subline: 'A harbour before dawn. A ship is taking hands.',
  loadFailure: 'The dock could not be loaded.',
});

/** The knot board's six pegs, their shown names (dockmap.js KNOTS carries the keys, in this order). */
export const DOCK_KNOT_NAMES = f(['Bowline', 'Reef knot', 'Sheet bend', 'Clove hitch', 'Figure of eight', 'Granny']);

/** The three lay tickets' shown names (dockmap.js LAY_TICKETS carries the keys, in this order; Melville ch. 16). */
export const DOCK_LAY_NAMES = f(['90th', '300th', '777th']);

/** The four tavern clippings' newsprint bodies, in reading order (approved 2026-11-21; after Verne, part 1, ch. 1, but clipping4). */
export const DOCK_CLIPPINGS = f({
  clipping1: '20 July 1866. The steamer Governor Higginson met a moving mass five miles off the east coast of Australia. Two columns of water rose from it, a hundred and fifty feet into the air.',
  clipping2: '23 July 1866. The Cristobal Colon reports the same in the Pacific, seven hundred leagues away, three days later. No whale known to science covers such a distance in such a time.',
  clipping3: 'A long object, spindle-shaped, occasionally phosphorescent, and infinitely larger and more rapid in its movements than a whale. So the captains agree. The learned societies do not.',
  clipping4: 'To the Editor. Sir, I struck it fair with a two-flued iron off the Banks. The iron rang, as on a boiler. It did not sound like a fish. I am forty years a whaleman.',
});

/** The poster by the tavern door, the painted signs, and the doubloon's own legend (Melville ch. 99). */
export const DOCK_WORLD_TEXT = f({
  poster: 'THIS EVENING. Professor P. Aronnax, of the Paris Museum, on the Mysteries of the Great Submarine Grounds, and the Sea Monster. Admission 25 cents.',
  signSpouterInn: 'Peter Coffin',
  signChandler: 'Ship Chandler',
  signShip: 'PEQUOD',
  doubloonLegend: 'REPUBLICA DEL ECUADOR: QUITO',
});
