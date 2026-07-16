// Story arc: six missions from fresh-off-the-bus errands to the Meridian Bank
// vault job. All characters are original: Vesna (fixer), Mo (mechanic),
// Fenster (docks fence).

export function buildStoryMissions(G) {
  const pois = G.city.pois;
  const line = (i) => G.city.linePos(i);
  const safe = pois.safehouse.door;
  const garage = pois.garage.door;
  const bank = pois.bank;
  const docks = pois.theftDrop.pos;

  // a parked target car on a residential street east of the safehouse
  // (line indices track the 48-block map's urban core)
  const repoCar = [line(34) + 4.7, line(23) + 26];
  // bank geometry helpers
  const bankRear = [2 * bank.pos[0] - bank.door[0], 2 * bank.pos[1] - bank.door[1]];
  const bankSide = [bank.pos[0] + (bank.door[1] - bank.pos[1]) * 1.4, bank.pos[1] - (bank.door[0] - bank.pos[0]) * 1.4];

  return [
    {
      id: 'ankommen',
      title: 'Welcome to Neustadt',
      subtitle: 'Vesna',
      reward: 300,
      giver: null, // auto-started on new game
      steps: [
        {
          type: 'cine', lines: [
            'VESNA: There you are. Neustadt Bay — half marble, half rust.',
            'VESNA: You drive, you keep quiet, you get paid. That order.',
            'VESNA: Mo runs a garage in the Marktviertel. Go introduce yourself.',
          ],
        },
        { type: 'goto', pos: garage, r: 5, text: 'Meet <b>Mo</b> at the garage in the Marktviertel.' },
        {
          type: 'cine', lines: [
            'MO: Vesna\'s new wheelman? You look broke.',
            'MO: Good. Broke people drive careful. Take this for walking money.',
          ],
        },
      ],
    },
    {
      id: 'repo',
      title: 'Repo Run',
      subtitle: 'Mo',
      prereq: 'ankommen',
      reward: 500,
      giver: garage,
      steps: [
        {
          type: 'cine', lines: [
            'MO: A Kurier RS, two months behind on payments. Gartenstadt.',
            'MO: Owner "forgot" where he parked it. Remind him it\'s ours now.',
            'MO: It has an alarm. Neighbours have phones. You have legs. Go.',
          ],
        },
        {
          type: 'goto', pos: repoCar, r: 30, text: 'Find the <b>Kurier RS</b> in Gartenstadt.',
          spawnVehicle: { tag: 'repo', model: 'kurier', pos: repoCar, ry: 0, locked: true, paint: '#5c6470' },
        },
        { type: 'enterVehicle', tag: 'repo', text: 'Break into the <b>Kurier RS</b> and take it.' },
        { type: 'goto', pos: garage, r: 7, requireVehicleTag: 'repo', text: 'Deliver the car to <b>Mo\'s garage</b>. Shake any heat first.' },
        { type: 'cine', lines: ['MO: Not a scratch… well, not many. You\'ll do.'] },
      ],
    },
    {
      id: 'kasse',
      title: 'Corner Store Blues',
      subtitle: 'Vesna',
      prereq: 'repo',
      reward: 800,
      giver: safe,
      steps: [
        {
          type: 'cine', lines: [
            'VESNA: Rent is due and the register at the 24/7 Markt is fat.',
            'VESNA: Walk in, show the piece, keep your aim on the clerk. The till does the rest.',
            'VESNA: Then vanish. Spray König cleans paint AND records.',
          ],
          // hand the player a pistol for their first armed job
        },
        {
          type: 'goto', pos: pois.shops[0].door, r: 26,
          giveWeapon: { id: 'pistol', ammo: 36 },
          text: 'Hit the marked <b>24/7 Markt</b>.',
        },
        { type: 'robShop', text: 'Hold up the clerk — <b>aim at them</b> until the register is empty.' },
        { type: 'loseWanted', text: 'Lose the police!' },
        { type: 'cine', lines: ['VESNA: Clean. Loud, but clean. There\'s hope for you.'] },
      ],
    },
    {
      id: 'beweis',
      title: 'Prove It',
      subtitle: 'Mo',
      prereq: 'kasse',
      reward: 1000,
      giver: garage,
      steps: [
        {
          type: 'cine', lines: [
            'MO: Street crews won\'t work with a nobody. Sunday they run the Innenstadt Circuit.',
            'MO: Win it. Entry\'s on me. Crash my car and I\'ll bill your ghost.',
          ],
        },
        { type: 'race', raceId: 'innenstadt', text: 'Win the <b>Innenstadt Circuit</b>.' },
        { type: 'cine', lines: ['MO: HA! They\'ll remember that. Vesna wants you at the docks.'] },
      ],
    },
    {
      id: 'blaupause',
      title: 'The Meridian Job: Recon',
      subtitle: 'Fenster',
      prereq: 'beweis',
      reward: 1500,
      giver: docks,
      steps: [
        {
          type: 'cine', lines: [
            'FENSTER: Meridian Bank. Marble front, cardboard back. We\'ve been watching it for a year.',
            'FENSTER: Walk the block. Front doors, the rear loading door, the camera junction on the side.',
            'FENSTER: Then bring me their armored Geldwagen so we can learn its locks.',
          ],
        },
        { type: 'goto', pos: bank.door, r: 6, text: 'Scope the <b>front entrance</b>.' },
        { type: 'goto', pos: bankRear, r: 7, text: 'Scope the <b>rear loading door</b>.' },
        { type: 'goto', pos: bankSide, r: 7, text: 'Find the <b>camera junction</b>.' },
        {
          type: 'enterVehicle', tag: 'geld', text: 'Steal the <b>Geldwagen</b> parked at the bank.',
          spawnVehicle: { tag: 'geld', model: 'geldwagen', pos: [bank.door[0] + 8, bank.door[1] + 4], ry: 1.6 },
          setStars: 0,
        },
        { type: 'wait', seconds: 0.5, setStars: 2, text: 'They saw you — GO!' },
        { type: 'goto', pos: docks, r: 8, requireVehicleTag: 'geld', text: 'Bring the Geldwagen to <b>Fenster\'s warehouse</b>.' },
        { type: 'loseWanted', text: 'Lose the police!' },
        { type: 'cine', lines: ['FENSTER: Beautiful. The locks sing to me. Rest up — tomorrow we play the big song.'] },
      ],
    },
    {
      id: 'meridian',
      title: 'The Meridian Job',
      subtitle: 'Vesna & Fenster',
      prereq: 'blaupause',
      reward: 25000,
      giver: docks,
      steps: [
        {
          type: 'cine', setHour: 23, lines: [
            'VESNA: Tonight. Three minutes inside, no bodies, no names.',
            'FENSTER: The vault dial is a three-step. Feel the window, tap it true.',
            'VESNA: When it opens, take the cash and burn for the docks. We\'ll hold the door.',
          ],
        },
        { type: 'goto', pos: bank.door, r: 4, text: 'Get inside <b>Meridian Bank</b>.', beam: 8 },
        { type: 'goto', pos: [bank.pos[0], bank.pos[1]], r: 6, text: 'Reach the <b>vault</b> at the back.' },
        { type: 'vaultCrack', pos: [bank.pos[0], bank.pos[1]], text: 'Crack the <b>vault lock</b>.' },
        {
          type: 'collectCash', pos: [bank.pos[0], bank.pos[1]], amount: 24000,
          text: 'Grab the <b>cash</b>!',
        },
        { type: 'wait', seconds: 0.5, setStars: 4, text: 'ALARM! Everyone in the city heard that.' },
        { type: 'goto', pos: docks, r: 8, text: 'Escape to the <b>docks</b>!' },
        { type: 'loseWanted', text: 'Shake the heat for good!' },
        {
          type: 'cine', lines: [
            'VESNA: Twenty-five large, minus expenses. Neustadt\'s yours now, kid.',
            'FENSTER: …until someone bigger notices. TO BE CONTINUED.',
          ],
        },
      ],
    },
  ];
}
