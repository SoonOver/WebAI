import './style.css'

const products = [
  {
    id: 1,
    name: 'Nova X1 Headphones',
    price: 2490000,
    icon: 'fa-headphones',
    description: 'Noise cancelling premium audio experience.'
  },
  {
    id: 2,
    name: 'Obsidian Watch',
    price: 3850000,
    icon: 'fa-stopwatch',
    description: 'Precision engineering meets timeless design.'
  },
  {
    id: 3,
    name: 'Aether Prism Glasses',
    price: 1200000,
    icon: 'fa-glasses',
    description: 'Smart eyewear for the modern visionary.'
  },
  {
    id: 4,
    name: 'Stellar Pods Pro',
    price: 1850000,
    icon: 'fa-ear-listen',
    description: 'Pure sound, zero boundaries.'
  },
  {
    id: 5,
    name: 'Lumina Tablet',
    price: 8900000,
    icon: 'fa-tablet-screen-button',
    description: 'The thinnest pro tablet ever made.'
  },
  {
    id: 6,
    name: 'Cypher Key',
    price: 1500000,
    icon: 'fa-key',
    description: 'The ultimate security for your digital assets.'
  }
];

let cart = JSON.parse(localStorage.getItem('cart')) || [];

function formatPrice(price) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(price);
}

function renderApp() {
  document.querySelector('#app').innerHTML = `
    <nav>
      <div class="container nav-content">
        <div class="logo">AETHERIA</div>
        <div class="nav-links">
          <a href="#">Beranda</a>
          <a href="#shop">Produk</a>
          <a href="#">Tentang</a>
          <div class="cart-icon" id="open-cart">
            <i class="fa-solid fa-cart-shopping"></i>
            <span class="cart-count" id="cart-count">0</span>
          </div>
        </div>
      </div>
    </nav>

    <header class="hero">
      <div class="hero-content">
        <h1>Elevate Your Digital Lifestyle</h1>
        <p>Temukan koleksi eksklusif perangkat masa depan yang dirancang untuk presisi dan gaya.</p>
        <button class="btn-primary" onclick="document.querySelector('#shop').scrollIntoView({behavior: 'smooth'})">
          Belanja Sekarang
        </button>
      </div>
    </header>

    <main class="container" id="shop">
      <section class="section-title">
        <h2>Koleksi Unggulan</h2>
        <p>Inovasi terbaik dalam genggaman Anda.</p>
      </section>

      <div class="products-grid" id="product-list">
        <!-- Products will be injected here -->
      </div>
    </main>

    <div class="overlay" id="overlay"></div>
    
    <div class="cart-drawer" id="cart-drawer">
      <div class="cart-header">
        <h3>Keranjang Belanja</h3>
        <span class="close-cart" id="close-cart"><i class="fa-solid fa-xmark"></i></span>
      </div>
      <div class="cart-items" id="cart-items">
        <!-- Cart items will be injected here -->
      </div>
      <div class="cart-footer">
        <div class="total-row">
          <span>Total</span>
          <span id="cart-total">Rp 0</span>
        </div>
        <button class="checkout-btn" id="checkout-btn">Checkout</button>
      </div>
    </div>
  `;

  renderProducts();
  updateCartUI();
  setupEventListeners();
}

function renderProducts() {
  const productList = document.querySelector('#product-list');
  productList.innerHTML = products.map(product => `
    <div class="product-card">
      <div class="product-image">
        <i class="fa-solid ${product.icon}"></i>
      </div>
      <div class="product-info">
        <h3>${product.name}</h3>
        <p style="color: #a0a0a8; font-size: 0.9rem; margin-bottom: 1rem;">${product.description}</p>
        <span class="price">${formatPrice(product.price)}</span>
        <button class="add-to-cart" data-id="${product.id}">Tambah ke Keranjang</button>
      </div>
    </div>
  `).join('');
}

function updateCartUI() {
  const cartCount = document.querySelector('#cart-count');
  const cartItems = document.querySelector('#cart-items');
  const cartTotal = document.querySelector('#cart-total');
  
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = totalCount;

  if (cart.length === 0) {
    cartItems.innerHTML = '<p style="text-align: center; color: #a0a0a8; margin-top: 2rem;">Keranjang Anda kosong.</p>';
  } else {
    cartItems.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div style="width: 70px; height: 70px; border-radius: 12px; background: var(--glass); display: flex; align-items: center; justify-content: center; border: 1px solid var(--glass-border); flex-shrink: 0;">
          <i class="fa-solid ${item.icon}" style="color: var(--accent-color); font-size: 1.5rem;"></i>
        </div>
        <div class="cart-item-info">
          <h4>${item.name}</h4>
          <p>${formatPrice(item.price)} x ${item.quantity}</p>
          <div style="margin-top: 5px; display: flex; gap: 10px; align-items: center;">
             <button class="qty-btn" onclick="updateQty(${item.id}, -1)" style="background:none; border:1px solid #444; color:#fff; cursor:pointer; width:25px; border-radius:4px;">-</button>
             <span>${item.quantity}</span>
             <button class="qty-btn" onclick="updateQty(${item.id}, 1)" style="background:none; border:1px solid #444; color:#fff; cursor:pointer; width:25px; border-radius:4px;">+</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  cartTotal.textContent = formatPrice(total);
  
  localStorage.setItem('cart', JSON.stringify(cart));
}

function setupEventListeners() {
  const openCart = document.querySelector('#open-cart');
  const closeCart = document.querySelector('#close-cart');
  const cartDrawer = document.querySelector('#cart-drawer');
  const overlay = document.querySelector('#overlay');

  openCart.addEventListener('click', () => {
    cartDrawer.classList.add('open');
    overlay.classList.add('show');
  });

  const hideCart = () => {
    cartDrawer.classList.remove('open');
    overlay.classList.remove('show');
  };

  closeCart.addEventListener('click', hideCart);
  overlay.addEventListener('click', hideCart);

  document.querySelector('#product-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('add-to-cart')) {
      const id = parseInt(e.target.dataset.id);
      addToCart(id);
    }
  });

  document.querySelector('#checkout-btn').addEventListener('click', () => {
    if (cart.length === 0) {
      alert('Keranjang Anda kosong!');
      return;
    }
    alert('Pesanan Anda telah diterima! Terima kasih telah berbelanja di Aetheria Luxe.');
    cart = [];
    updateCartUI();
    hideCart();
  });
}

function addToCart(id) {
  const product = products.find(p => p.id === id);
  const existingItem = cart.find(item => item.id === id);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }

  updateCartUI();
  
  // Show drawer on add
  document.querySelector('#cart-drawer').classList.add('open');
  document.querySelector('#overlay').classList.add('show');
}

// Global function for quantity updates
window.updateQty = (id, delta) => {
  const item = cart.find(i => i.id === id);
  if (item) {
    item.quantity += delta;
    if (item.quantity <= 0) {
      cart = cart.filter(i => i.id !== id);
    }
    updateCartUI();
  }
};

renderApp();
