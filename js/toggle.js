// Good-cheap-fast: at most two switches can be on at once.
// Turning on the third switches off the one that "breaks" the trade-off.
document.addEventListener('DOMContentLoaded', function () {
  var next = { fast: 'cheap', cheap: 'good', good: 'fast' };
  var boxes = document.querySelectorAll('.check');
  boxes.forEach(function (box) {
    box.addEventListener('change', function () {
      var allOn = Array.prototype.every.call(boxes, function (b) { return b.checked; });
      if (allOn) {
        document.getElementById(next[box.id]).checked = false;
      }
    });
  });
});
