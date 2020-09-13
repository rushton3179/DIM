import { getPlatforms } from 'app/accounts/platforms';
import { currentAccountSelector } from 'app/accounts/selectors';
import { ThunkDispatchProp, ThunkResult } from 'app/store/types';
import _ from 'lodash';
import { BehaviorSubject, ConnectableObservable, Subject } from 'rxjs';
import { merge, publishReplay, switchMap, take } from 'rxjs/operators';
import { DestinyAccount } from '../accounts/destiny-account';
import { getStores } from '../bungie-api/destiny1-api';
import { bungieErrorToaster } from '../bungie-api/error-toaster';
import { D1ManifestDefinitions, getDefinitions } from '../destiny1/d1-definitions';
import { fetchRatings } from '../item-review/destiny-tracker.service';
import { showNotification } from '../notifications/notifications';
import { loadingTracker } from '../shell/loading-tracker';
import store from '../store/store';
import { reportException } from '../utils/exceptions';
import { error, loadNewItems, update } from './actions';
import { cleanInfos } from './dim-item-info';
import { InventoryBuckets } from './inventory-buckets';
import { D1Item } from './item-types';
import { bucketsSelector, storesSelector } from './selectors';
import { D1Store, D1StoreServiceType, D1Vault, DimVault } from './store-types';
import { processItems, resetIdTracker } from './store/d1-item-factory';
import { makeCharacter, makeVault } from './store/d1-store-factory';

const badDispatch = store.dispatch as ThunkDispatchProp['dispatch'];

export const D1StoresService = StoreService();

function StoreService(): D1StoreServiceType {
  // A subject that keeps track of the current account. Because it's a
  // behavior subject, any new subscriber will always see its last
  // value.
  const accountStream = new BehaviorSubject<DestinyAccount | null>(null);

  // The triggering observable for force-reloading stores.
  const forceReloadTrigger = new Subject();

  // A stream of stores that switches on account changes and supports reloading.
  // This is a ConnectableObservable that must be connected to start.
  const storesStream = accountStream.pipe(
    // But also re-emit the current value of the account stream
    // whenever the force reload triggers
    merge(forceReloadTrigger.pipe(switchMap(() => accountStream.pipe(take(1))))),
    // Whenever either trigger happens, load stores
    switchMap(() => loadingTracker.addPromise(badDispatch(loadStores()))),
    // Keep track of the last value for new subscribers
    publishReplay(1)
  ) as ConnectableObservable<D1Store[] | undefined>;
  // TODO: If we can make the store structures immutable, we could use
  //       distinctUntilChanged to avoid emitting store updates when
  //       nothing changed!

  const service = {
    getStoresStream,
    reloadStores,
  };

  return service;

  /**
   * Set the current account, and get a stream of stores updates.
   * This will keep returning stores even if something else changes
   * the account by also calling "storesStream". This won't force the
   * stores to reload unless they haven't been loaded at all.
   *
   * @return a stream of store updates
   */
  function getStoresStream(account: DestinyAccount) {
    accountStream.next(account);
    // Start the stream the first time it's asked for. Repeated calls
    // won't do anything.
    storesStream.connect();
    return storesStream;
  }

  /**
   * Force the inventory and characters to reload.
   * @return the new stores
   */
  function reloadStores() {
    // adhere to the old contract by returning the next value as a
    // promise We take 2 from the stream because the publishReplay
    // will always return the latest value instantly, and we want the
    // next value (the refreshed value). toPromise returns the last
    // value in the sequence.
    const promise = storesStream.pipe(take(2)).toPromise();
    forceReloadTrigger.next(); // signal the force reload
    return promise;
  }
}

/**
 * Returns a promise for a fresh view of the stores and their items.
 */
// TODO: combine with d2 stores action!
export function loadStores(): ThunkResult<D1Store[] | undefined> {
  return async (dispatch, getState) => {
    const promise = (async () => {
      try {
        let account = currentAccountSelector(getState());
        if (!account) {
          await dispatch(getPlatforms());
          account = currentAccountSelector(getState());
          if (!account) {
            return;
          }
        }
        resetIdTracker();

        const [defs, , rawStores] = await Promise.all([
          (dispatch(getDefinitions()) as any) as Promise<D1ManifestDefinitions>,
          dispatch(loadNewItems(account)),
          getStores(account),
        ]);
        const lastPlayedDate = findLastPlayedDate(rawStores);
        const buckets = bucketsSelector(store.getState())!;

        // Currencies object gets mutated by processStore
        const currencies: DimVault['currencies'] = [];

        const stores = await Promise.all(
          _.compact(
            (rawStores as any[]).map((raw) =>
              processStore(raw, defs, buckets, currencies, lastPlayedDate)
            )
          )
        );

        if ($featureFlags.reviewsEnabled) {
          dispatch(fetchRatings(stores));
        }

        dispatch(cleanInfos(stores));

        // Let our styling know how many characters there are
        document
          .querySelector('html')!
          .style.setProperty('--num-characters', String(stores.length - 1));

        dispatch(update({ stores }));

        return stores;
      } catch (e) {
        console.error('Error loading stores', e);
        reportException('D1StoresService', e);
        if (storesSelector(store.getState()).length > 0) {
          // don't replace their inventory with the error, just notify
          showNotification(bungieErrorToaster(e));
        } else {
          dispatch(error(e));
        }
        // It's important that we swallow all errors here - otherwise
        // our observable will fail on the first error. We could work
        // around that with some rxjs operators, but it's easier to
        // just make this never fail.
        return undefined;
      }
    })();
    loadingTracker.addPromise(promise);
    return promise;
  };
}

/**
 * Process a single store from its raw form to a DIM store, with all the items.
 */
function processStore(
  raw,
  defs: D1ManifestDefinitions,
  buckets: InventoryBuckets,
  currencies: DimVault['currencies'],
  lastPlayedDate: Date
) {
  if (!raw) {
    return undefined;
  }

  let store: D1Store;
  let items: D1Item[];
  if (raw.id === 'vault') {
    const result = makeVault(raw, currencies);
    store = result.store;
    items = result.items;
  } else {
    const result = makeCharacter(raw, defs, lastPlayedDate, currencies);
    store = result.store;
    items = result.items;
  }

  return processItems(store, items, defs, buckets).then((items) => {
    store.items = items;

    // by type-bucket
    store.buckets = _.groupBy(items, (i) => i.location.hash);

    // Fill in any missing buckets
    Object.values(buckets.byType).forEach((bucket) => {
      if (!store.buckets[bucket.hash]) {
        store.buckets[bucket.hash] = [];
      }
    });

    if (isVault(store)) {
      const vault = store;
      vault.vaultCounts = {};
      const vaultBucketOrder = [
        4046403665, // Weapons
        3003523923, // Armor
        138197802, // General
      ];

      _.sortBy(
        Object.values(buckets.byType).filter((b) => b.vaultBucket),
        (b) => vaultBucketOrder.indexOf(b.vaultBucket!.hash)
      ).forEach((bucket) => {
        const vaultBucketId = bucket.vaultBucket!.hash;
        vault.vaultCounts[vaultBucketId] = vault.vaultCounts[vaultBucketId] || {
          count: 0,
          bucket: bucket.accountWide ? bucket : bucket.vaultBucket,
        };
        vault.vaultCounts[vaultBucketId].count += store.buckets[bucket.hash].length;
      });
    }

    return store;
  });
}

function isVault(store: D1Store): store is D1Vault {
  return store.isVault;
}

/**
 * Find the date of the most recently played character.
 */
function findLastPlayedDate(rawStores: any[]): Date {
  return Object.values(rawStores).reduce((memo, rawStore) => {
    if (rawStore.id === 'vault') {
      return memo;
    }

    const d1 = new Date(rawStore.character.base.characterBase.dateLastPlayed);

    return memo ? (d1 >= memo ? d1 : memo) : d1;
  }, new Date(0));
}
