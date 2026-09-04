import { parsePrice, parseRating, cleanTitle, toPendingWatch } from './lib/normalise.mjs';
console.log(parsePrice('£1,299.00'), parsePrice('$89.99'), parsePrice('n/a'));
console.log('ratings:', parseRating('4.4 out of 5 stars'), parseRating('nope'));
console.log('title:', cleanTitle('SEIKO 5 Sports SRPD55K1 Automatic Watch, Stainless Steel, Black Dial, 40mm, Day Date, 100m Water Resistant, Mens'));
const w = toPendingWatch({ asin: 'b01abcdefg', title: 'Seiko Prospex Turtle Automatic Diver 200m Sapphire', price: '£329.99', rating: '4.6 out of 5 stars' });
console.log({ brand: w.brand, style: w.style, movement: w.movement, tier: w.tier, price: w.price_display, rating: w.rating, status: w.status });
