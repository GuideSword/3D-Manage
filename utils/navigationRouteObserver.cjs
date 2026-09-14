'use strict';

const subscribeToNavigationRoute = (navigationRef, onRouteName) => {
  if (!navigationRef || typeof navigationRef.isReady !== 'function') {
    throw new TypeError('A navigation container ref is required');
  }
  if (typeof onRouteName !== 'function') {
    throw new TypeError('A route listener is required');
  }

  const syncRoute = () => {
    if (!navigationRef.isReady()) return;
    onRouteName(navigationRef.getCurrentRoute()?.name ?? null);
  };
  const unsubscribeReady = navigationRef.addListener('ready', syncRoute);
  const unsubscribeState = navigationRef.addListener('state', syncRoute);

  syncRoute();

  return () => {
    unsubscribeReady();
    unsubscribeState();
  };
};

module.exports = { subscribeToNavigationRoute };
