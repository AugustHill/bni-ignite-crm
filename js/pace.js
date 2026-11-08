// The "pace to goal" numbers on the admin Dashboard: what the goal date
// demands (one new member every N weeks) versus what is actually happening
// (guests per week lately), and, once there is enough history, how many
// guests per week it would take at the chapter's own close rate.
//
// Kept apart from the page so the arithmetic can be tested on its own.

(function () {
  // current: members now. target: goal headcount. daysLeft: days until the
  // goal date. attended / joined: all-time guests who attended / who joined
  // (the close rate is joined / attended). recentGuests: guests who attended
  // in the last 4 weeks.
  function compute(input) {
    const { current, target, daysLeft, attended, joined, recentGuests } = input;
    const remaining = Math.max(0, target - current);
    const recentPerWeek = (recentGuests || 0) / 4;
    if (remaining === 0) return { state: 'reached', remaining, recentPerWeek };
    if (daysLeft <= 0) return { state: 'passed', remaining, recentPerWeek };
    const weeksLeft = daysLeft / 7;
    // Needs a few guests and at least one who joined, or the rate is a guess.
    const closeRate = attended >= 5 && joined > 0 ? joined / attended : null;
    return {
      state: 'pace',
      remaining,
      weeksLeft,
      everyWeeks: weeksLeft / remaining,
      closeRate,
      neededPerWeek: closeRate ? remaining / closeRate / weeksLeft : null,
      recentPerWeek,
    };
  }

  function html(p) {
    if (p.state === 'reached') return '<p style="margin:0;"><strong>Goal reached.</strong> Every seat is filled.</p>';
    if (p.state === 'passed') return `<p style="margin:0;">The target date has passed with <strong>${p.remaining}</strong> to go.</p>`;
    const lines = [`<p style="margin:0 0 6px;"><strong>${p.remaining} more member${p.remaining === 1 ? '' : 's'}</strong> in about <strong>${Math.round(p.weeksLeft)} weeks</strong>: one new member every <strong>${p.everyWeeks.toFixed(1)} weeks</strong>.</p>`];
    if (p.closeRate) {
      lines.push(`<p style="margin:0;">At your close rate (${Math.round(p.closeRate * 100)}% of guests who attend join) you need about <strong>${p.neededPerWeek.toFixed(1)} guests per week</strong>. Last 4 weeks: <strong>${p.recentPerWeek.toFixed(1)}</strong> per week.</p>`);
    } else {
      lines.push(`<p style="margin:0;">Last 4 weeks: <strong>${p.recentPerWeek.toFixed(1)}</strong> guests per week. The guests-needed estimate appears once a few guests have attended and one has joined.</p>`);
    }
    return lines.join('');
  }

  const api = { compute, html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Pace = api;
})();
