document.querySelector('#play').addEventListener('click', () => {
  window.ctx = new AudioContext();
  window.osc = window.ctx.createOscillator();
  window.osc.connect(window.ctx.destination);
  window.osc.start();
});

window.audioReady = true;
