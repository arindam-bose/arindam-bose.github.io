// ============================================================
// About and How to use -- the two pages of words in Settings.
//
// Dialogs, on the same plumbing as the ledger: opened from a line
// in the About tile, with no address of their own.  Fixed text,
// so render() ignores the store; the dialog's refresh still runs
// on every write and simply paints the same thing again.
// ============================================================

import { detailHead, detailSection } from '../render.js';
import { detailDialog } from '../dialog.js';

const ABOUT = `
  ${detailHead('About', 'This tool')}

  <div class="prose">
    <p>A companion for crafting in Red Dead Redemption 2's story mode. Every
      recipe Pearson, the Trapper and the Fence will make for you, and every
      one you can cook up at your own campfire, with what each one takes and
      where to find it.</p>
    <p>The game leaves you to remember which pelt goes to whom. This keeps
      the list for you: log what you carry, and the guide works out what you
      can craft right now and what you are still short of.</p>
  </div>

  ${detailSection('Private by design', `
    <div class="prose">
      <p>There is no account and no server behind it. The recipes ship with
        the page, and everything you log stays in this browser - nothing is
        uploaded, ever. Once it has loaded it works without a signal, and
        added to your home screen it opens like an app.</p>
      <p>The flip side is that your data lives only here. Use
        <strong>Back up</strong> at the top now and then, and keep the file
        somewhere safe.</p>
    </div>`)}

  ${detailSection('Where it comes from', `
    <div class="prose">
      <p>The reference data was gathered from community guides and wikis,
        credited under Acknowledgements in Settings. It is a fan-made tool,
        not affiliated with or endorsed by Rockstar Games or Take-Two
        Interactive.</p>
      <p>Made with love by Arindam Bose, powered by Claude.</p>
    </div>`)}`;

const HOW_TO = `
  ${detailHead('Guide', 'How to use this tool')}

  ${detailSection('1. Pick a mode', `
    <div class="prose">
      <p><strong>Personalize</strong>, the default, tracks what you have:
        cards show your stock against what each vendor wants, and anything
        crafted or skipped drops out of the way. <strong>General</strong> is
        the plain reference, every recipe and every quantity. Switch between
        them at the top of any page.</p>
    </div>`)}

  ${detailSection('2. Find what you need', `
    <div class="prose">
      <p><strong>Materials</strong> lists everything there is to collect -
        animal parts, plants and supplies - with the recipes each one goes
        into and the vendors who still want it. Filter by vendor, or by
        what is still needed. Open a card to see where it comes from, and
        which weapon - or for a fish, which bait - brings it in perfect.</p>
    </div>`)}

  ${detailSection('3. Log what you gather', `
    <div class="prose">
      <p>Two ways, whichever suits the moment:</p>
      <ul>
        <li>In a material's card, <strong>+ Add</strong> and
          <strong>-</strong> log one at a time, straight away.</li>
        <li>On <strong>Inventory</strong>, pick the Satchel, Pearson or the
          Trapper, step the counts up or down, then <strong>Save</strong>
          them as one batch. The smaller counter on a row, marked with a
          vendor's icon, hands items from your Satchel to the Trapper or
          Pearson - and on their pages, back again.</li>
      </ul>
      <p>Every change offers <strong>Undo</strong> for a few seconds.</p>
    </div>`)}

  ${detailSection('4. Craft', `
    <div class="prose">
      <p>On <strong>Recipes</strong>, <strong>Ready to craft</strong> shows
        what you can make right now. Open a recipe and press
        <strong>Craft</strong>: its ingredients are taken from that vendor's
        stock - the Fence draws on your Satchel - and it is marked crafted.
        <strong>Skip</strong> retires a recipe you do not want, and
        <strong>Put back</strong> undoes a craft.</p>
      <p>The <strong>Campfire</strong> tab is for looking up: those recipes
        can be made as often as you like, so they are never ticked off.</p>
    </div>`)}

  ${detailSection('5. Keep a backup', `
    <div class="prose">
      <p><strong>Back up</strong> at the top saves everything to one file.
        A dot appears on it when a backup is due, and turns red when it is
        overdue. To bring a file back, use <strong>Bring it back</strong> in
        Settings, or the restore button on an empty Inventory page.</p>
      <p><strong>Your stats</strong> in Settings shows your progress, and
        <strong>Ledger entries</strong> there opens the full history of
        everything you have logged.</p>
    </div>`)}`;

/** A dialog of fixed words.  Returns { open, destroy }, like the ledger's. */
function textDialog(html) {
  const dialog = detailDialog({ render: () => html });
  return {
    open: () => dialog.open('text'),
    destroy: dialog.destroy,
  };
}

export const aboutDialog = () => textDialog(ABOUT);
export const howToDialog = () => textDialog(HOW_TO);
