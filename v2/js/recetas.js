// Recetario de ideas saludables (fijo, sin internet). Macros APROXIMADOS por porción;
// Alfredo NO come pescado ni mariscos: no agregar recetas con pescado, atún, salmón, camarón ni similares.
// kcal ≈ 4·proteína + 4·carbohidratos + 9·grasa. Ingredientes fáciles de conseguir en México.
// tags: proteina (≥30 g), rapido (≤15 min), vegetariano, ligero (≤320 kcal)
export const SLOTS = { desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena', snack: 'Snack' };

const R = (key, slot, name, mins, p, c, f, tags, ingredients, steps) => ({
  key, slot, name, mins, protein: p, carbs: c, fat: f,
  kcal: Math.round((4 * p + 4 * c + 9 * f) / 5) * 5,
  tags: [...tags, ...(p >= 30 ? ['proteina'] : []), ...(mins <= 15 ? ['rapido'] : [])].filter((x, i, a) => a.indexOf(x) === i),
  ingredients, steps
});

export const RECIPES = [
  // ── Desayunos ──
  R('huevos-nopales', 'desayuno', 'Huevos revueltos con nopales y frijoles', 15, 28, 30, 12, [],
    ['2 huevos + 2 claras', '1 taza de nopales en tiras (cocidos)', '½ taza de frijoles de la olla', '1 tortilla de maíz', 'Salsa al gusto'],
    ['Saltea los nopales en sartén antiadherente hasta que suelten la baba.', 'Agrega los huevos y claras batidos y revuelve a fuego medio.', 'Sirve con los frijoles calientes, la tortilla y salsa.']),
  R('avena-proteina', 'desayuno', 'Avena con proteína y frutos rojos', 10, 32, 45, 11, [],
    ['½ taza de avena (40 g)', '1 scoop de proteína en polvo', '1 taza de agua o leche light', '½ taza de frutos rojos', '1 cda de crema de cacahuate', 'Canela'],
    ['Cuece la avena con el agua o leche 3–4 min.', 'Retira del fuego y mezcla la proteína (así no se hace grumos).', 'Corona con frutos rojos, crema de cacahuate y canela.']),
  R('yogur-bowl', 'desayuno', 'Bowl de yogur griego con plátano y chía', 5, 24, 38, 9, ['vegetariano'],
    ['200 g de yogur griego natural sin azúcar', '½ plátano en rodajas', '2 cdas de granola baja en azúcar', '1 cda de chía', 'Canela'],
    ['Sirve el yogur en un tazón.', 'Agrega el plátano, la granola y la chía.', 'Espolvorea canela.']),
  R('chilaquiles-horneados', 'desayuno', 'Chilaquiles horneados con pollo', 25, 35, 42, 12, [],
    ['3 tortillas de maíz en triángulos', '1 taza de salsa verde', '100 g de pechuga de pollo deshebrada', '30 g de queso fresco', '1 cda de crema light', 'Cebolla y cilantro'],
    ['Hornea los triángulos de tortilla a 200 °C por 10–12 min hasta que estén crujientes.', 'Calienta la salsa con el pollo.', 'Mezcla con los totopos justo antes de servir y agrega queso, crema, cebolla y cilantro.']),
  R('omelette-claras', 'desayuno', 'Omelette de claras con espinaca y panela', 12, 34, 18, 11, ['vegetariano'],
    ['1 huevo + 4 claras', '1 taza de espinaca', '½ taza de champiñones', '40 g de queso panela', '1 rebanada de pan integral'],
    ['Saltea champiñones y espinaca.', 'Vierte el huevo y las claras batidos; cocina a fuego bajo tapado.', 'Agrega la panela, dobla y sirve con el pan tostado.']),
  R('molletes-integrales', 'desayuno', 'Molletes integrales con pico de gallo', 15, 20, 45, 9, ['vegetariano'],
    ['1 bolillo integral (o 2 rebanadas de pan integral)', '½ taza de frijoles refritos sin manteca', '40 g de queso oaxaca light', 'Pico de gallo (jitomate, cebolla, chile, cilantro)'],
    ['Unta los frijoles en el pan y pon el queso encima.', 'Hornea o tuesta 5–7 min hasta que gratine.', 'Sirve con mucho pico de gallo.']),
  R('licuado-verde', 'desayuno', 'Licuado verde con proteína', 5, 28, 28, 8, [],
    ['1 taza de espinaca', '½ plátano congelado', '1 scoop de proteína', '1 cda de chía', '250 ml de leche de almendra sin azúcar', 'Hielo'],
    ['Licúa todo hasta que quede terso.', 'Si queda espeso, agrega un poco más de leche o agua.']),

  // ── Comidas ──
  R('pollo-arroz-brocoli', 'comida', 'Pollo a la plancha con arroz integral y brócoli', 25, 48, 40, 9, [],
    ['150 g de pechuga de pollo', '¾ taza de arroz integral cocido', '1 taza de brócoli', '1 cdita de aceite de oliva', 'Ajo, limón, sal y pimienta'],
    ['Sazona el pollo con ajo, limón, sal y pimienta.', 'Cocínalo a la plancha 5–6 min por lado.', 'Cuece el brócoli al vapor 4 min y sirve con el arroz y un chorrito de aceite.']),
  R('tacos-pollo-pastor', 'comida', 'Tacos de pollo al pastor con piña', 25, 40, 45, 11, [],
    ['150 g de pechuga de pollo en tiras', '1 cda de adobo de achiote (o chile guajillo + vinagre + ajo)', '3 tortillas de maíz', '¼ de taza de piña en cubos', 'Cebolla y cilantro', '¼ de aguacate', 'Salsa al gusto'],
    ['Marina el pollo con el adobo al menos 10 min.', 'Cocínalo en sartén caliente 6–8 min; agrega la piña el último minuto.', 'Arma los tacos con cebolla, cilantro, aguacate y salsa.']),
  R('bowl-pollo-quinoa', 'comida', 'Bowl de pollo, quinoa y aguacate', 15, 38, 32, 12, [],
    ['120 g de pechuga de pollo cocida en cubos', '¾ taza de quinoa cocida', '½ pepino en cubos', '1 jitomate en cubos', '¼ de aguacate', 'Limón, sal y chile en polvo'],
    ['En un tazón pon la quinoa y el pollo.', 'Agrega pepino, jitomate y aguacate.', 'Sazona con limón, sal y chile.']),
  R('caldo-pollo', 'comida', 'Caldo de pollo con verduras', 40, 38, 30, 7, [],
    ['150 g de pollo sin piel', '1 calabacita', '1 zanahoria', '1 chayote', '½ taza de arroz cocido', 'Cebolla, ajo, cilantro y limón'],
    ['Hierve el pollo con cebolla y ajo 20 min.', 'Agrega las verduras en trozos y cocina 10–15 min más.', 'Sirve con el arroz, cilantro y limón.']),
  R('fajitas-res', 'comida', 'Fajitas de res con pimiento y frijoles', 20, 42, 42, 13, [],
    ['150 g de bistec de res magro en tiras', '1 pimiento en tiras', '½ cebolla', '½ taza de frijoles de la olla', '2 tortillas de maíz'],
    ['Saltea la carne a fuego alto 3–4 min y retírala.', 'En el mismo sartén cocina pimiento y cebolla.', 'Regresa la carne, sazona y sirve con frijoles y tortillas.']),
  R('ensalada-pollo-mango', 'comida', 'Ensalada de pollo con mango y nuez', 15, 36, 28, 14, [],
    ['130 g de pechuga de pollo cocida', '2 tazas de lechugas mixtas', '½ mango en cubos', '15 g de nuez', 'Vinagreta: limón, mostaza, 1 cdita de aceite de oliva'],
    ['Corta el pollo en tiras.', 'Mezcla lechugas, mango y pollo.', 'Agrega la nuez y la vinagreta al servir.']),
  R('albondigas-pavo', 'comida', 'Albóndigas de pavo en chipotle con arroz', 35, 38, 34, 12, [],
    ['150 g de pavo molido', '1 clara', '2 jitomates + 1 chile chipotle (salsa)', '½ taza de arroz cocido', 'Ajo, cebolla, hierbabuena'],
    ['Mezcla el pavo con la clara, ajo y hierbabuena; forma albóndigas.', 'Licúa jitomate, chipotle, cebolla y ajo; cocina la salsa 5 min.', 'Agrega las albóndigas y cuece tapado 15 min. Sirve con el arroz.']),
  R('pollo-camote', 'comida', 'Pechuga al horno con camote y ejotes', 35, 46, 38, 8, [],
    ['150 g de pechuga de pollo', '150 g de camote en cubos', '1 taza de ejotes', 'Ajo, pimentón y limón', '1 cdita de aceite de oliva'],
    ['Hornea el camote a 200 °C por 15 min.', 'Sazona la pechuga con ajo, pimentón y limón; ponla en la charola con los ejotes.', 'Hornea 18–20 min más, hasta que el pollo esté bien cocido.']),
  R('lentejas-verduras', 'comida', 'Lentejas guisadas con verduras', 30, 26, 62, 5, ['vegetariano'],
    ['1½ tazas de lentejas cocidas', '1 zanahoria', '1 jitomate', '1 taza de espinaca', '1 tortilla de maíz', 'Ajo y cebolla'],
    ['Sofríe ajo, cebolla y jitomate picados.', 'Agrega las lentejas, la zanahoria y un poco de su caldo; cocina 10 min.', 'Al final agrega la espinaca. Sirve con la tortilla.']),

  // ── Cenas ──
  R('tostadas-tinga', 'cena', 'Tostadas horneadas de tinga de pollo', 20, 32, 33, 11, [],
    ['3 tostadas horneadas', '120 g de pollo deshebrado', '1 jitomate + ½ cebolla + chipotle (tinga)', 'Lechuga', '¼ de aguacate'],
    ['Cocina la cebolla en tiras, agrega jitomate licuado con chipotle y el pollo; 5 min.', 'Sirve sobre las tostadas con lechuga y aguacate.']),
  R('quesadillas-champi', 'cena', 'Quesadillas de champiñón y panela', 12, 22, 30, 10, ['vegetariano', 'ligero'],
    ['2 tortillas de maíz', '60 g de queso panela', '1 taza de champiñones rebanados', 'Epazote', 'Salsa'],
    ['Saltea los champiñones con epazote.', 'Rellena las tortillas con panela y champiñones; dóralas en comal.', 'Sirve con salsa.']),
  R('ensalada-pollo-garbanzo', 'cena', 'Ensalada de pollo con garbanzo', 10, 32, 24, 9, ['ligero'],
    ['100 g de pechuga de pollo cocida y deshebrada', '½ taza de garbanzo cocido', '1 jitomate', '¼ de cebolla morada', 'Cilantro, limón', '1 cdita de aceite de oliva'],
    ['Escurre el garbanzo.', 'Pica jitomate, cebolla y cilantro.', 'Mezcla todo con el pollo, limón, aceite, sal y pimienta.']),
  R('sopa-verduras-pollo', 'cena', 'Sopa de verduras con pollo deshebrado', 25, 28, 22, 6, ['ligero'],
    ['100 g de pollo deshebrado', '1 calabacita', '1 zanahoria', '½ taza de ejotes', '2 tazas de caldo de pollo desgrasado'],
    ['Hierve el caldo con las verduras en cubos 10–12 min.', 'Agrega el pollo y calienta 2 min.', 'Sirve con limón y chile al gusto.']),
  R('wrap-pavo-hummus', 'cena', 'Wrap integral de pavo y hummus', 8, 26, 32, 10, ['ligero'],
    ['1 tortilla de harina integral', '80 g de pechuga de pavo', '2 cdas de hummus', 'Espinaca', '½ jitomate'],
    ['Unta el hummus en la tortilla.', 'Agrega pavo, espinaca y jitomate.', 'Enrolla y dóralo 1 min por lado en sartén.']),
  R('huevos-mexicana', 'cena', 'Huevos a la mexicana con frijoles', 12, 24, 22, 11, ['vegetariano', 'ligero'],
    ['2 huevos + 2 claras', '1 jitomate, ¼ de cebolla y 1 chile serrano picados', '½ taza de frijoles de la olla'],
    ['Sofríe jitomate, cebolla y chile 2 min.', 'Agrega los huevos y revuelve hasta que cuajen.', 'Sirve con los frijoles.']),
  R('calabacitas-rellenas', 'cena', 'Calabacitas rellenas de carne magra', 30, 30, 14, 14, ['ligero'],
    ['2 calabacitas', '120 g de carne molida de res 90/10', '1 jitomate picado', '20 g de queso rallado'],
    ['Parte las calabacitas a lo largo y saca un poco de pulpa.', 'Guisa la carne con jitomate y la pulpa picada.', 'Rellena, pon el queso y hornea a 200 °C por 15 min.']),

  // ── Snacks ──
  R('jicama-pepino', 'snack', 'Jícama, pepino y zanahoria con limón y chile', 5, 2, 20, 0, ['vegetariano', 'ligero'],
    ['1 taza de jícama', '½ pepino', '1 zanahoria', 'Limón y chile en polvo'],
    ['Corta todo en bastones.', 'Agrega limón y chile.']),
  R('manzana-cacahuate', 'snack', 'Manzana con crema de cacahuate', 2, 4, 25, 8, ['vegetariano', 'ligero'],
    ['1 manzana', '1 cda de crema de cacahuate natural'],
    ['Rebana la manzana y acompáñala con la crema de cacahuate.']),
  R('yogur-miel-nuez', 'snack', 'Yogur griego con miel y nuez', 2, 15, 14, 7, ['vegetariano', 'ligero'],
    ['150 g de yogur griego natural', '1 cdita de miel', '10 g de nuez'],
    ['Sirve el yogur con la miel y la nuez picada.']),
  R('edamames', 'snack', 'Edamames con sal y limón', 6, 17, 14, 8, ['vegetariano', 'ligero'],
    ['1 taza de edamames congelados', 'Sal de grano y limón'],
    ['Cuécelos en agua hirviendo o microondas 4–5 min.', 'Agrega sal y limón.']),
  R('huevos-cocidos', 'snack', 'Huevos cocidos con pepino', 12, 13, 3, 10, ['vegetariano', 'ligero'],
    ['2 huevos', '½ pepino', 'Sal, pimienta y chile'],
    ['Cuece los huevos 10 min y enfríalos en agua.', 'Sirve con el pepino en rodajas.']),
  R('requeson-fresas', 'snack', 'Requesón con fresas', 3, 14, 14, 4, ['vegetariano', 'ligero'],
    ['½ taza de requesón', '1 taza de fresas'],
    ['Sirve el requesón con las fresas picadas.'])
];

export const TAGS = { proteina: 'Alto en proteína', rapido: 'Rápido', vegetariano: 'Vegetariano', ligero: 'Ligero' };
export const recipe = key => RECIPES.find(r => r.key === key);

// Ideas para hoy: una por tiempo de comida que rota cada día; si te falta mucha proteína, prioriza las altas en proteína.
export function ideasFor(dayStr, proteinLeft = 0) {
  const seed = [...dayStr].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return Object.keys(SLOTS).map((slot, i) => {
    let list = RECIPES.filter(r => r.slot === slot);
    if (proteinLeft > 60 && slot !== 'snack') { const hp = list.filter(r => r.tags.includes('proteina')); if (hp.length) list = hp; }
    return list[(seed + i * 7) % list.length];
  });
}
