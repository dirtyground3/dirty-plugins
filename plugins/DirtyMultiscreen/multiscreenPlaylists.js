// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyMultiscreenPlaylists";
  if (window[INSTANCE_KEY]) return;

  /** @template T @param {T[]} items @returns {T[]} */
  function shuffleMultiscreenItems(items) {
    var shuffledItems = items.slice();
    for (var i = shuffledItems.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var item = shuffledItems[i];
      shuffledItems[i] = shuffledItems[j];
      shuffledItems[j] = item;
    }
    return shuffledItems;
  }

  /** @template T @param {T[]} items @param {number} total @returns {T[][]} */
  function splitMultiscreenItemsByIndex(items, total) {
    var groups = Array.from({ length: Math.max(0, total) }, function () { return []; });
    items.forEach(function (item, index) {
      var group = groups[index % total];
      if (group) group.push(item);
    });
    return groups;
  }

  /** @template T @param {T[]} items @param {number} totalScreens @param {boolean} randomize @param {boolean} splitItems @returns {T[][]} */
  function createMultiscreenPlaylists(items, totalScreens, randomize, splitItems) {
    if (items.length === 0) {
      return Array.from({ length: Math.max(0, totalScreens) }, function () { return []; });
    }
    if (splitItems) {
      var sourceItems = randomize ? shuffleMultiscreenItems(items) : items.slice();
      return splitMultiscreenItemsByIndex(sourceItems, totalScreens);
    }
    return Array.from(
      { length: Math.max(0, totalScreens) },
      function () { return randomize ? shuffleMultiscreenItems(items) : items.slice(); }
    );
  }

  window[INSTANCE_KEY] = {
    shuffleMultiscreenItems: shuffleMultiscreenItems,
    splitMultiscreenItemsByIndex: splitMultiscreenItemsByIndex,
    createMultiscreenPlaylists: createMultiscreenPlaylists
  };
})();
