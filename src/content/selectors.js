(function (root) {
  'use strict';

  var RESERVED_SEGMENTS = [
    'explore', 'reels', 'reel', 'p', 'tv', 'stories', 'direct', 'accounts',
    'about', 'developer', 'legal', 'emailsignup', 'api', 'challenge',
    'privacy', 'terms', 'jobs', 'developers', 'settings', 'notifications',
    'inbox', 'session', 'oauth', 'static', 'graphql', 'favicon.ico', 'robots.txt'
  ];

  var BUSINESS_KEYWORDS = [
    'shop', 'store', 'boutique', 'clinic', 'salon', 'spa', 'restaurant', 'cafe',
    'coffee', 'bakery', 'dental', 'derma', 'dermatology', 'aesthetic', 'aesthetics',
    'medical', 'medicine', 'fashion', 'clothing', 'jewelry', 'jewellery', 'real estate',
    'property', 'realtor', 'agency', 'studio', 'gym', 'fitness', 'hotel', 'travel',
    'tour', 'automotive', 'car', 'bike', 'motor', 'electronics', 'mobile', 'phone',
    'furniture', 'interiors', 'interior', 'photography', 'education', 'academy',
    'school', 'university', 'law', 'lawyer', 'attorney', 'accounting', 'consulting',
    'marketing', 'digital', 'construction', 'architect', 'architects', 'beauty',
    'makeup', 'nails', 'barber', 'lashes', 'skincare', 'cosmetics', 'hair',
    'lasers', 'liposuction', 'surgery', 'physio', 'therapy', 'dentist', 'orthodont',
    'plumbing', 'electrician', 'cleaning', 'laundry', 'delivery', 'logistics',
    'catering', 'events', 'wedding', 'florist', 'printing', 'signage', 'textile',
    'garments', 'wholesale', 'supplier', 'distributor', 'importer', 'exporter',
    'gymwear', 'supplements', 'pharmacy', 'optics', 'optical', 'eyewear',
    'hardware', 'tools', 'kitchen', 'bakery', 'patisserie', 'grill', 'bistro',
    'pizzeria', 'food', 'burger', 'pizza', 'sweets', 'chocolates', 'ice cream',
    'juices', 'smoothies', 'tea', 'nutrition', 'diet', 'wellness', 'yoga',
    'pilates', 'martial arts', 'boxing', 'sports', 'academy', 'institute',
    'tutors', 'coaching', 'training', 'courses', 'kindergarten', 'daycare',
    'veterinary', 'pets', 'grooming', 'realty', 'builders', 'developers',
    'logistics', 'courier', 'transport', 'taxi', 'rent a car', 'car rental',
    'insurance', 'finance', 'bank', 'microfinance', 'chit fund', 'money',
    'sewing', 'tailor', 'alterations', 'embroidery', 'handmade', 'gifts',
    'toys', 'baby', 'maternity', 'kids', 'children', 'uniforms', 'shoes',
    'footwear', 'bags', 'watches', 'perfume', 'fragrance', 'salons', 'nail art',
    'make up artist', 'henna', 'mehndi', 'tattoo', 'piercing', 'pools',
    'landscaping', 'gardening', 'painting', 'plaster', 'tiles', 'marble',
    'granite', 'wood', 'steel', 'aluminium', 'glass', 'solar', 'inverter',
    'generators', 'ac', 'air conditioner', 'refrigeration', 'appliances',
    'cameras', 'cctv', 'security', 'networking', 'computers', 'laptop',
    'software', 'website', 'app', 'tech', 'it solutions', 'cloud',
    'gym ', 'salon ', 'dental ', 'dental clinic', 'skin clinic'
  ];

  var BUSINESS_UI_TEXT = [
    'contact', 'call', 'email', 'book', 'booking', 'reserve', 'order',
    'shop now', 'whatsapp', 'get directions', 'view menu', 'appointments',
    'buy now', 'enquire', 'inquire', 'quote', 'estimate', 'subscribe'
  ];

  var STRONG_SIGNAL_LABELS = [
    'category', 'business', 'store', 'shop', 'restaurant', 'clinic',
    'contact info', 'phone number', 'email address', 'address', 'website'
  ];

  var STATUS_VALUES = ['New', 'Reviewed', 'Contacted', 'Ignore'];

  function isReservedSegment(segment) {
    return RESERVED_SEGMENTS.indexOf(String(segment || '').toLowerCase()) !== -1;
  }

  function isExternalHost(hostname) {
    if (!hostname) return false;
    var host = String(hostname).toLowerCase();
    var blocked = [
      'instagram.com', 'www.instagram.com', 'cdninstagram.com',
      'facebook.com', 'www.facebook.com', 'fbcdn.net',
      'google.com', 'gstatic.com', 'googletagmanager.com',
      'twitter.com', 'x.com', 'youtube.com'
    ];
    if (blocked.indexOf(host) !== -1) return false;
    if (/(^|\.)instagram\.com$/.test(host)) return false;
    if (/(^|\.)facebook\.com$/.test(host)) return false;
    if (/(^|\.)fbcdn\.net$/.test(host)) return false;
    if (/(^|\.)cdninstagram\.com$/.test(host)) return false;
    return true;
  }

  var Selectors = {
    RESERVED_SEGMENTS: RESERVED_SEGMENTS,
    BUSINESS_KEYWORDS: BUSINESS_KEYWORDS,
    BUSINESS_UI_TEXT: BUSINESS_UI_TEXT,
    STRONG_SIGNAL_LABELS: STRONG_SIGNAL_LABELS,
    STATUS_VALUES: STATUS_VALUES,
    isReservedSegment: isReservedSegment,
    isExternalHost: isExternalHost
  };

  root.FicinoSelectors = Selectors;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Selectors;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
