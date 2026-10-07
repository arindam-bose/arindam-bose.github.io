// ============================================================
// A material, opened -- the same dialog wherever it is opened.
//
// Materials opens one from its cards, Inventory from the names on
// its rows.  Both get the same body and the same steppers, so a
// material reads and behaves alike from either page; only the
// address differs (#/materials/<id> or #/inventory/<id>), so that
// shutting it leaves you on the page you opened it from.
//
// `group` is the shape both build the card from: the demand query
// returns one row per (material, station), the usage query one per
// (material, recipe), the animals query one per (material, animal),
// and a card is per material, so all three are folded in.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { materialDetail, placeName } from '../render.js';
import { toast } from '../toast.js';
import { detailDialog } from '../dialog.js';

export function group(rows, usage, animals) {
  const byIngredient = new Map();

  for (const row of rows) {
    let card = byIngredient.get(row.ingredient_id);
    if (!card) {
      card = {
        ingredient_id: row.ingredient_id,
        material: row.material,
        quality: row.quality,
        source_type: row.source_type,
        body_part: row.body_part,
        animals: [],
        demands: [],
        usage: [],
      };
      byIngredient.set(row.ingredient_id, card);
    }
    card.demands.push({
      station_id: row.station_id,
      station: row.station,
      color: row.color,
      campfire: Boolean(row.campfire),
      location_id: row.location_id,
      location: row.location,
      needed: row.needed,
      have: row.have,
    });
  }

  for (const u of usage) {
    byIngredient.get(u.ingredient_id)?.usage.push(u);
  }
  for (const a of animals) {
    byIngredient.get(a.ingredient_id)?.animals.push(a);
  }

  return [...byIngredient.values()];
}

/**
 * Every material's card, fresh from the database -- for a page that
 * does not keep them itself.  Materials does, for its gallery, and
 * passes its own `find` instead.
 */
export function freshCard(id) {
  return group(queries.materials({ personal: store.isPersonal() }),
               queries.materialUsage(), queries.materialAnimals())
    .find((m) => m.ingredient_id === id);
}

/**
 * The dialog, addressed under `route`.  `find(id)` returns the card
 * to show, or nothing if there is no such material.
 */
export function materialDialog({ route, find = freshCard }) {
  return detailDialog({
    route,

    render(id) {
      const card = find(id);
      return card ? materialDetail(card, { personal: store.isPersonal() }) : null;
    },

    // One tap, one ledger row, straight away: the stepper on Inventory
    // stages a batch, but here you are logging one thing and looking
    // right at the result, so a save step would only be in the way.
    async onClick(event, id) {
      const button = event.target.closest('[data-delta]');
      const card = find(id);
      const d = card?.demands.find(
        (x) => x.location_id === button?.closest('[data-location]').dataset.location);
      if (!button || !d) return;

      const delta = Number(button.dataset.delta);
      const written = await store.record({
        ingredient_id: id,
        location_id: d.location_id,
        delta,
        reason: store.reasonFor(card.source_type, delta),
      });

      const place = placeName(d.location_id, d.location);
      toast(delta > 0 ? `Added one ${card.material} to ${place}`
                      : `Took one ${card.material} from ${place}`,
            { label: 'Undo', run: () => store.undo(written.id) });
    },
  });
}
