console.info('Grandload offscreen document ready.');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void message;
  sendResponse({ ok: true, data: { offscreen: true } });
  return false;
});
