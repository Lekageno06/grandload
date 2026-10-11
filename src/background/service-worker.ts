console.info('Grandload service worker started.');

chrome.runtime.onInstalled.addListener(() => {
  console.info('Grandload installed.');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void message;
  sendResponse({ ok: true, data: { ready: true } });
  return false;
});
