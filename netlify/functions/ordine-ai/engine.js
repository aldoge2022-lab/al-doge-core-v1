export const aiEngine = {
  generatePizza({ richiesta, menu }) {
    const ingredientiDisponibili = [...new Set(menu.flatMap(p => p.ingredienti))];

    const ingredienti = ingredientiDisponibili
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    return {
      nome: 'Pizza Personalizzata',
      ingredienti,
      prezzo: 6 + ingredienti.length * 1.5
    };
  },

  generatePanino({ richiesta, menu }) {
    const ingredientiDisponibili = [...new Set(menu.flatMap(p => p.ingredienti))];

    const ingredienti = ingredientiDisponibili
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);

    return {
      nome: 'Panino Personalizzato',
      ingredienti,
      prezzo: 5 + ingredienti.length * 1.5
    };
  }
};
