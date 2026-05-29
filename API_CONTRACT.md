# API Contract

## Endpoint
- Method: `POST`
- URL: `https://api.fuel-status.atan.ru/gasstations.Edge/ListGasStationsForMap`

## Ожидаемый ответ
Корневой объект:
- `gas_stations: GasStation[]`

`GasStation`:
- `id: string`
- `title: string`
- `address: string`
- `uuid: string`
- `a92: FuelStatus`
- `a95: FuelStatus`
- `a95_ultra: FuelStatus`
- `a100: FuelStatus`
- `diesel: FuelStatus`
- `diesel_ultra: FuelStatus`
- `lpg: FuelStatus`
- `lat_lng: { lat: number, lng: number }`

`FuelStatus`:
- `FUEL_STATUS_IN_STOCK`
- `FUEL_STATUS_LIMITED`
- `FUEL_STATUS_OUT_OF_STOCK`
- `FUEL_STATUS_UNAVAILABLE`

UI-легенда (как на карте):
- `FUEL_STATUS_IN_STOCK` - "Все виды оплат"
- `FUEL_STATUS_LIMITED` - "Талоны и топливные карты"
- `FUEL_STATUS_OUT_OF_STOCK` / `FUEL_STATUS_UNAVAILABLE` - "Временно не отпускается"

## Примечания по данным
- В тестовой фикстуре `response.md` 142 АЗС.
- Возможны неидеальные строковые поля (например, пробелы по краям `title`), поэтому перед выводом лучше делать `trim()`.
- Рекомендуется хранить в коде whitelist допустимых статусов и логировать неизвестные значения.

## Валидация (минимум)
1. Проверять, что `gas_stations` массив.
2. Проверять наличие `uuid`, `title`, `address`.
3. Проверять, что `lat_lng.lat/lng` числа.
4. Проверять, что каждое топливное поле содержит одно из известных значений.
