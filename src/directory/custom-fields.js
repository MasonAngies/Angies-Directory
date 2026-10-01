// Fields the directory owner added by hand in Kintone. Kintone generated their
// codes, so the codes say nothing; the labels are what people see on the form.
// Renaming a code is a UI-only change in Kintone: if anyone does, change it here.

export const CUSTOM_FIELDS = {
  storeFormat: 'Radio_button',
  orderMethods: 'Check_box_0',
  speedExceptions: 'Check_box',
  breakfastWindow: 'Number_2',
  lunchWindow: 'Number_3',
  dinnerWindow: 'Number_4',
  breakfastKiosk: 'Number',
  lunchKiosk: 'Number_0',
  dinnerKiosk: 'Number_1',
};

export const CUSTOM_FIELD_LABELS = {
  Radio_button: 'Store Format',
  Check_box_0: 'Order Method(s)',
  Check_box: 'Speed Exceptions Granted',
  Number_2: 'Breakfast Window',
  Number_3: 'Lunch Window',
  Number_4: 'Dinner Window',
  Number: 'Breakfast Kiosk',
  Number_0: 'Lunch Kiosk',
  Number_1: 'Dinner Kiosk',
};

// Speed goals are whole seconds, the same unit the dashboard's SOS_GOALS uses.
export const SPEED_GOAL_FIELDS = ['Number_2', 'Number_3', 'Number_4', 'Number', 'Number_0', 'Number_1'];

export const fieldLabel = (code) => CUSTOM_FIELD_LABELS[code] ?? code.replace(/_/g, ' ');
