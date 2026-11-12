(function () {
  var el = document.getElementById('toast');
  function toast(msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1700);
  }
  window.mockToast = toast;

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-toast]');
    if (!t) return;
    if (t.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    toast(t.getAttribute('data-toast'));
  });
})();
