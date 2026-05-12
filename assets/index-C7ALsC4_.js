(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=[{id:1,name:`Nova X1 Headphones`,price:249e4,icon:`fa-headphones`,description:`Noise cancelling premium audio experience.`},{id:2,name:`Obsidian Watch`,price:385e4,icon:`fa-stopwatch`,description:`Precision engineering meets timeless design.`},{id:3,name:`Aether Prism Glasses`,price:12e5,icon:`fa-glasses`,description:`Smart eyewear for the modern visionary.`},{id:4,name:`Stellar Pods Pro`,price:185e4,icon:`fa-ear-listen`,description:`Pure sound, zero boundaries.`},{id:5,name:`Lumina Tablet`,price:89e5,icon:`fa-tablet-screen-button`,description:`The thinnest pro tablet ever made.`},{id:6,name:`Cypher Key`,price:15e5,icon:`fa-key`,description:`The ultimate security for your digital assets.`}],t=JSON.parse(localStorage.getItem(`cart`))||[];function n(e){return new Intl.NumberFormat(`id-ID`,{style:`currency`,currency:`IDR`,minimumFractionDigits:0}).format(e)}function r(){document.querySelector(`#app`).innerHTML=`
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
  `,i(),a(),o()}function i(){let t=document.querySelector(`#product-list`);t.innerHTML=e.map(e=>`
    <div class="product-card">
      <div class="product-image">
        <i class="fa-solid ${e.icon}"></i>
      </div>
      <div class="product-info">
        <h3>${e.name}</h3>
        <p style="color: #a0a0a8; font-size: 0.9rem; margin-bottom: 1rem;">${e.description}</p>
        <span class="price">${n(e.price)}</span>
        <button class="add-to-cart" data-id="${e.id}">Tambah ke Keranjang</button>
      </div>
    </div>
  `).join(``)}function a(){let e=document.querySelector(`#cart-count`),r=document.querySelector(`#cart-items`),i=document.querySelector(`#cart-total`);e.textContent=t.reduce((e,t)=>e+t.quantity,0),t.length===0?r.innerHTML=`<p style="text-align: center; color: #a0a0a8; margin-top: 2rem;">Keranjang Anda kosong.</p>`:r.innerHTML=t.map(e=>`
      <div class="cart-item">
        <div style="width: 70px; height: 70px; border-radius: 12px; background: var(--glass); display: flex; align-items: center; justify-content: center; border: 1px solid var(--glass-border); flex-shrink: 0;">
          <i class="fa-solid ${e.icon}" style="color: var(--accent-color); font-size: 1.5rem;"></i>
        </div>
        <div class="cart-item-info">
          <h4>${e.name}</h4>
          <p>${n(e.price)} x ${e.quantity}</p>
          <div style="margin-top: 5px; display: flex; gap: 10px; align-items: center;">
             <button class="qty-btn" onclick="updateQty(${e.id}, -1)" style="background:none; border:1px solid #444; color:#fff; cursor:pointer; width:25px; border-radius:4px;">-</button>
             <span>${e.quantity}</span>
             <button class="qty-btn" onclick="updateQty(${e.id}, 1)" style="background:none; border:1px solid #444; color:#fff; cursor:pointer; width:25px; border-radius:4px;">+</button>
          </div>
        </div>
      </div>
    `).join(``),i.textContent=n(t.reduce((e,t)=>e+t.price*t.quantity,0)),localStorage.setItem(`cart`,JSON.stringify(t))}function o(){let e=document.querySelector(`#open-cart`),n=document.querySelector(`#close-cart`),r=document.querySelector(`#cart-drawer`),i=document.querySelector(`#overlay`);e.addEventListener(`click`,()=>{r.classList.add(`open`),i.classList.add(`show`)});let o=()=>{r.classList.remove(`open`),i.classList.remove(`show`)};n.addEventListener(`click`,o),i.addEventListener(`click`,o),document.querySelector(`#product-list`).addEventListener(`click`,e=>{e.target.classList.contains(`add-to-cart`)&&s(parseInt(e.target.dataset.id))}),document.querySelector(`#checkout-btn`).addEventListener(`click`,()=>{if(t.length===0){alert(`Keranjang Anda kosong!`);return}alert(`Pesanan Anda telah diterima! Terima kasih telah berbelanja di Aetheria Luxe.`),t=[],a(),o()})}function s(n){let r=e.find(e=>e.id===n),i=t.find(e=>e.id===n);i?i.quantity+=1:t.push({...r,quantity:1}),a(),document.querySelector(`#cart-drawer`).classList.add(`open`),document.querySelector(`#overlay`).classList.add(`show`)}window.updateQty=(e,n)=>{let r=t.find(t=>t.id===e);r&&(r.quantity+=n,r.quantity<=0&&(t=t.filter(t=>t.id!==e)),a())},r();