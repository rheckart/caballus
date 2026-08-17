/*
 * The quiz component. Retrieval practice with an immediate, automatic
 * feedback loop — the tightest one available on a static page.
 *
 * Markup contract:
 *
 *   <div class="quiz">
 *     <p class="q">Question?</p>
 *     <button data-correct>The right answer</button>
 *     <button>A wrong answer</button>
 *     <p class="why">Why the right answer is right.</p>
 *   </div>
 *
 * Answers should be the same length as each other. A longer option reads as
 * the careful one and gives the answer away on format alone, which turns
 * retrieval into pattern-matching and teaches nothing.
 *
 * Order is shuffled on load so that a second pass through a lesson is a second
 * retrieval rather than a memory of which button was third.
 */
;(function () {
  function shuffle(nodes, parent) {
    for (let i = nodes.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[nodes[i], nodes[j]] = [nodes[j], nodes[i]]
    }
    nodes.forEach((node) => parent.appendChild(node))
  }

  document.querySelectorAll('.quiz').forEach((quiz) => {
    const options = Array.from(quiz.querySelectorAll('button'))
    const why = quiz.querySelector('.why')

    // Re-inserted in a random order, before the explanation.
    shuffle(options, quiz)
    if (why) quiz.appendChild(why)

    options.forEach((option) => {
      option.addEventListener('click', () => {
        if (quiz.classList.contains('answered')) return
        quiz.classList.add('answered')

        options.forEach((other) => {
          other.disabled = true
          // Every correct answer is marked, not just the one clicked: seeing
          // the right answer beside the wrong one is the feedback.
          if (other.hasAttribute('data-correct')) other.classList.add('right')
          else if (other === option) other.classList.add('wrong')
        })
      })
    })
  })
})()
