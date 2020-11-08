const fs = require('fs');
const path = require('path');
const itemsperpage = 2;
const Product = require('../models/product');
const Order = require('../models/order');
const PDFDocument = require('pdfkit');
const stripe = require('stripe')(process.env.STRIPE_KEY);
exports.getProducts = (req, res, next) => {
  const page = +req.query.page || 1;
  let totalitems;
  Product.find().count()
  .then(numproducts => {
    totalitems = numproducts;
    return Product.find()
  .skip((page-1)*itemsperpage)
  .limit(itemsperpage)
  })
    .then(products => {
      res.render('shop/product-list', {
        prods: products,
        pageTitle: 'All Products',
        path: '/products',
        totalproducts: totalitems,
        currentpage: page,
        hasNextPage: itemsperpage * page < totalitems,
        hasPreviouspage: page > 1,
        nextPage: page + 1,
        lastPage: Math.ceil(totalitems/itemsperpage),
        previousPage: page - 1
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getProduct = (req, res, next) => {
  const prodId = req.params.productId;
  Product.findById(prodId)
    .then(product => {
      res.render('shop/product-detail', {
        product: product,
        pageTitle: product.title,
        path: '/products'
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getIndex = (req, res, next) => {
  const page = +req.query.page || 1;
  let totalitems;
  Product.find().count()
  .then(numproducts => {
    totalitems = numproducts;
    return Product.find()
  .skip((page-1)*itemsperpage)
  .limit(itemsperpage)
  })
    .then(products => {
      res.render('shop/index', {
        prods: products,
        pageTitle: 'Shop',
        path: '/',
        totalproducts: totalitems,
        currentpage: page,
        hasNextPage: itemsperpage * page < totalitems,
        hasPreviouspage: page > 1,
        nextPage: page + 1,
        lastPage: Math.ceil(totalitems/itemsperpage),
        previousPage: page - 1
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getCart = (req, res, next) => {
  req.user
    .populate('cart.items.productId')
    .execPopulate()
    .then(user => {
      const products = user.cart.items;
      res.render('shop/cart', {
        path: '/cart',
        pageTitle: 'Your Cart',
        products: products
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.postCart = (req, res, next) => {
  const prodId = req.body.productId;
  Product.findById(prodId)
    .then(product => {
      return req.user.addToCart(product);
    })
    .then(result => {
      console.log(result);
      res.redirect('/cart');
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.postCartDeleteProduct = (req, res, next) => {
  const prodId = req.body.productId;
  req.user
    .removeFromCart(prodId)
    .then(result => {
      res.redirect('/cart');
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getcheckout = (req, res, next) => {
  let products;
  let totalprice = 0;
  req.user
    .populate('cart.items.productId')
    .execPopulate()
    .then(user => {
      products = user.cart.items;
      products.forEach(p => {
        totalprice = totalprice + p.productId.price;
      });
      return stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: products.map(p => {
          return {
            name: p.productId.title,
            description: p.productId.description,
            amount: p.productId.price,
            currency: 'usd',
            quantity: p.quantity
          };
        }),
        success_url: req.protocol + "://" + req.get('host') + '/checkout/success',
        cancel_url: req.protocol + "://" + req.get('host') + '/checkout/cancel'
      })
    })
      .then(session => {
      res.render('shop/checkout', {
        path: '/checkout',
        pageTitle: 'Checkout',
        products: products,
        totalprice: totalprice,
        sessionId: session.id
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};
exports.postOrder = (req, res, next) => {
  req.user
    .populate('cart.items.productId')
    .execPopulate()
    .then(user => {
      const products = user.cart.items.map(i => {
        return { quantity: i.quantity, product: { ...i.productId._doc } };
      });
      const order = new Order({
        user: {
          email: req.user.email,
          userId: req.user
        },
        products: products
      });
      return order.save();
    })
    .then(result => {
      return req.user.clearCart();
    })
    .then(() => {
      res.redirect('/orders');
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getOrders = (req, res, next) => {
  Order.find({ 'user.userId': req.user._id })
    .then(orders => {
      res.render('shop/orders', {
        path: '/orders',
        pageTitle: 'Your Orders',
        orders: orders
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getInvoice = (req, res, next) => {
  const orderId = req.params.orderId;
  Order.findById(orderId)
    .then(order => {
      if (!order) {
        return next(new Error('No order found.'));
      }
      if (order.user.userId.toString() !== req.user._id.toString()) {
        return next(new Error('Unauthorized'));
      }
      const invoiceName = 'invoice-' + orderId + '.pdf';
      const invoicePath = path.join('data', 'invoices', invoiceName);
      const pdfdoc = new PDFDocument();
      res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          'inline; filename="' + invoiceName + '"'
        );
      pdfdoc.pipe(fs.createWriteStream(invoicePath));
      pdfdoc.pipe(res);
      pdfdoc.text('hello here is your invoice');
      pdfdoc.fontSize(26).text('Invoice',{
        underline: true
      });
      pdfdoc.text('--------------------------');
      order.products.forEach(prod => {
        pdfdoc.text(prod.quantity + '$' + prod.product.price);
      });
      pdfdoc.end();
      /*fs.readFile(invoicePath, (err, data) => {
        if (err) {
          return next(err);
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          'inline; filename="' + invoiceName + '"'
        );
        res.send(data);
      });*/
      const file = fs.createReadStream(invoicePath);
      res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          'inline; filename="' + invoiceName + '"'
        );
        file.pipe(res);
    })
    .catch(err => next(err));
};
