# Иллюстрации локаций (тушь + акварель в SVG)

Сцены «Дома бригад» и «Жилой сектор» нарисованы кодом: дрожащая тушь,
акварельные заливки с растёком и пигментом, бумажная фактура — в стиле
сцен Центра и Гаражей. Пересобрать:

    cd tools/art
    node scene-houses.cjs  && node render.cjs scene-houses.svg  ../../frontend/src/shared/assets/ui/scene-brigade-houses
    node scene-housing.cjs && node render.cjs scene-housing.svg ../../frontend/src/shared/assets/ui/scene-housing

`render.cjs` пишет рядом `.png`, `.webp` и `-preview.png`; в игру идёт только `.webp`
(лишнее удалить). Нужен установленный Playwright в `frontend/`.
