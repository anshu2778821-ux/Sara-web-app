self.onmessage = function(e) {
  if (e.data === 'start') {
    setInterval(() => {
      self.postMessage('tick');
    }, 5000);
  }
};
