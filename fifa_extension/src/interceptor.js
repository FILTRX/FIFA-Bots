// Runs at document_start in MAIN world — before ANY page scripts including Datadome
// Hooks XHR to intercept STX widget's seats/free/ol response
(function() {
  if (window.__fbIntercepting) return;
  window.__fbIntercepting = true;

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSet  = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._fbUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (name === 'X-CSRF-Token' && value && !value.startsWith('INIT')) {
      window.postMessage({ __fb: true, type: 'csrf', value }, '*');
    }
    return origSet.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    const url = this._fbUrl || '';
    if (url.includes('seats/free/ol') || url.includes('seats/free/polygon')) {
      this.addEventListener('load', function() {
        if (this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            const features = data?.features || [];
            if (features.length > 0) {
              // postMessage works across MAIN ↔ ISOLATED worlds
              window.postMessage({ __fb: true, type: 'seats', features }, '*');
            }
          } catch(e) {}
        }
      });
    }
    // Capture productId
    const m = url.match(/productId=(\d{10,})/);
    if (m) {
      window.postMessage({ __fb: true, type: 'productId', value: m[1] }, '*');
    }
    return origSend.apply(this, arguments);
  };
})();
